import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { EXTERNAL_FRAME } from "./errors";
import {
	initializeAnalyticsWithSinkFactoryForTests,
	reportClientError,
	reportError,
	reportFatalError,
	resetAnalyticsForTests,
	shutdownAnalytics,
} from "./service";
import { createPostHogSink } from "./sink";

interface BatchEntry {
	event: string;
	distinct_id: string;
	properties: Record<string, unknown>;
}

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-error-reports-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetAnalyticsForTests();
});

afterEach(() => {
	resetAnalyticsForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function boot(
	sent: BatchEntry[],
	overrides: Partial<Parameters<typeof initializeAnalyticsWithSinkFactoryForTests>[0]> = {},
): void {
	initializeAnalyticsWithSinkFactoryForTests(
		{
			posthogApiKey: "phc_test",
			appVersion: "1.2.3",
			channel: "stable",
			build: "binary",
			additionalEnabled: false,
			env: {},
			fetchImpl: ((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
				sent.push(...JSON.parse(String(init?.body)).batch);
				return Promise.resolve(new Response("{}", { status: 200 }));
			}) as typeof fetch,
			...overrides,
		},
		(options) => createPostHogSink({ ...options, retryDelayMs: 10 }),
	);
}

function exceptions(sent: BatchEntry[]): BatchEntry[] {
	return sent.filter((entry) => entry.event === "$exception");
}

function piiLadenError(): Error {
	const home = homedir();
	const error = new Error(`open '${home}/acme/secret-plan.md' failed for jane@example.com`);
	error.cause = new Error(`git: origin/jane-hotfix rejected at ${home}/acme`);
	error.stack = `${error.stack}\n    at computeSalary (${home}/.pi/agent/extensions/payroll.ts:3:4)`;
	return error;
}

test("a reported error reaches PostHog with no personal data in the actual request", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	reportError(piiLadenError(), { source: "request", handled: true, requestMethod: "project.open" });
	await shutdownAnalytics();
	const [entry, ...rest] = exceptions(sent);
	expect(rest).toEqual([]);
	if (!entry) throw new Error("no $exception was sent");
	const wire = JSON.stringify(entry);
	for (const forbidden of [
		homedir(),
		userInfo().username,
		"secret-plan",
		"jane",
		"payroll",
		"computeSalary",
		"context_line",
		"pre_context",
		"post_context",
		"abs_path",
		"vars",
	]) {
		expect(wire).not.toContain(forbidden);
	}
	const list = entry.properties.$exception_list as Array<Record<string, unknown>>;
	expect(list.map((exception) => exception.value)).toEqual([
		"open <str> failed for <email>",
		"git: <path> rejected at <path>",
	]);
	const frames = (list[0]?.stacktrace as { frames: Array<Record<string, unknown>> }).frames;
	expect(
		frames.some((frame) => frame.filename === "packages/server/src/analytics/errorReports.test.ts"),
	).toBe(true);
	expect(frames.some((frame) => frame.filename === EXTERNAL_FRAME && frame.function === "?")).toBe(
		true,
	);
	expect(entry.properties).toMatchObject({
		source: "request",
		handled: true,
		request_method: "project.open",
		app_version: "1.2.3",
		channel: "stable",
		build: "binary",
		$process_person_profile: false,
	});
});

test.each([
	{ additionalEnabled: false },
	{ mute: true },
	{ env: { THINKRAIL_NO_ANALYTICS: "1" } },
])("error reports ignore the additional-data preference and per-run suppression %j", async (options) => {
	const sent: BatchEntry[] = [];
	boot(sent, options);
	reportError(new Error("boom"), { source: "host_logged", handled: true, scope: "agent" });
	await shutdownAnalytics();
	expect(exceptions(sent)).toHaveLength(1);
	expect(exceptions(sent)[0]?.properties.scope).toBe("agent");
});

test.each([
	{ CI: "1" },
	{ NODE_ENV: "test" },
])("automated environment %j reports no errors", async (env) => {
	const sent: BatchEntry[] = [];
	boot(sent, { env });
	reportError(new Error("boom"), { source: "request", handled: true });
	await reportFatalError(new Error("fatal"));
	await shutdownAnalytics();
	expect(sent).toEqual([]);
});

test("identical reports are deduplicated and the per-launch volume is capped", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	for (let i = 0; i < 3; i++) reportError(new Error("same"), { source: "ui", handled: false });
	for (let i = 0; i < 150; i++)
		reportError(new Error(`distinct ${i}`), { source: "ui", handled: false });
	await shutdownAnalytics();
	expect(exceptions(sent)).toHaveLength(100);
});

test("a fatal report is sent immediately as level fatal with the CodedError-style code", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	const error = Object.assign(new Error("exploded"), { code: "ENOENT" });
	await reportFatalError(error);
	const [entry] = exceptions(sent);
	expect(entry?.properties).toMatchObject({
		source: "host_crash",
		handled: false,
		code: "ENOENT",
		$exception_level: "fatal",
	});
});

test("client errors keep WebKit stacks parseable and their frames web-relative", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	reportClientError({
		kind: "render",
		boundary: "plan rail",
		type: "TypeError",
		message: "undefined is not an object (evaluating 'jane.name')",
		stack: "render@http://127.0.0.1:4317/assets/index-abc.js:10:5\nhttps://evil.example/x.js:1:1",
	});
	reportClientError({ kind: "bogus", type: 42, message: { jane: true } });
	await shutdownAnalytics();
	expect(
		exceptions(sent)
			.map((entry) => [entry.properties.scope, entry.properties.handled])
			.sort(),
	).toEqual([
		["render:plan_rail", true],
		["window", false],
	]);
	const render = exceptions(sent).find((entry) => entry.properties.scope === "render:plan_rail");
	const list = render?.properties.$exception_list as Array<Record<string, unknown>>;
	expect(list[0]?.type).toBe("TypeError");
	expect(list[0]?.value).toBe("undefined is not an object (evaluating <str>)");
	const frames = (list[0]?.stacktrace as { frames: Array<Record<string, unknown>> }).frames;
	expect(frames).toContainEqual({
		platform: "web:javascript",
		filename: "web/assets/index-abc.js",
		function: "render",
		lineno: 10,
		colno: 5,
		in_app: true,
	});
	expect(JSON.stringify(frames)).not.toContain("evil.example");
});

test("chunk ids reach PostHog: registered bundles via the SDK, browser chunks via the report", async () => {
	const id = "01a15438-b3fb-7af1-a9d9-5a7475549eac";
	const webId = "ab8fcdab-5c22-55ed-bec8-0f9acb6a407e";
	const registry = globalThis as { _posthogChunkIds?: Record<string, string> };
	registry._posthogChunkIds = { [`Error\n    at ${import.meta.path}:1:1`]: id };
	try {
		const sent: BatchEntry[] = [];
		boot(sent);
		reportError(new Error("bundled"), { source: "request", handled: true });
		reportClientError({
			kind: "window",
			type: "TypeError",
			message: "x",
			stack: "f@http://127.0.0.1:4317/assets/index-abc.js:10:5",
			chunkIds: { "http://127.0.0.1:4317/assets/index-abc.js": webId },
		});
		await shutdownAnalytics();
		const chunkIds = exceptions(sent).flatMap((entry) =>
			(
				entry.properties.$exception_list as Array<{
					stacktrace: { frames: Array<Record<string, unknown>> };
				}>
			)
				.flatMap((exception) => exception.stacktrace.frames)
				.map((frame) => frame.chunk_id)
				.filter(Boolean),
		);
		expect(chunkIds).toContain(id);
		expect(chunkIds).toContain(webId);
		expect(JSON.stringify(sent)).not.toContain("$thinkrail_chunk_ids");
	} finally {
		delete registry._posthogChunkIds;
	}
});

test("the report's handled flag reaches the root exception mechanism; causes stay handled", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	const fatal = new Error("fatal");
	fatal.cause = new Error("root cause");
	await reportFatalError(fatal);
	reportClientError({ kind: "window", type: "TypeError", message: "x", stack: "" });
	reportError(new Error("request"), { source: "request", handled: true });
	await shutdownAnalytics();
	const mechanisms = Object.fromEntries(
		exceptions(sent).map((entry) => [
			entry.properties.source,
			(entry.properties.$exception_list as Array<{ mechanism?: { handled?: boolean } }>).map(
				(exception) => exception.mechanism?.handled,
			),
		]),
	);
	expect(mechanisms).toEqual({
		host_crash: [false, true],
		ui: [false],
		request: [true],
	});
});
