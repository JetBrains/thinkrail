import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
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

const WIRE_KEYS = [
	"$exception_level",
	"$exception_list",
	"$geoip_disable",
	"$is_server",
	"$lib",
	"$lib_version",
	"$process_person_profile",
	"app_version",
	"arch",
	"build",
	"channel",
	"handled",
	"os",
	"request_method",
	"source",
];

test("a reported error reaches PostHog as a classifier with no personal data in the actual request", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	reportError(piiLadenError(), { source: "request", handled: true, requestMethod: "project.open" });
	await shutdownAnalytics();
	const [entry, ...rest] = exceptions(sent);
	expect(rest).toEqual([]);
	if (!entry) throw new Error("no $exception was sent");
	expect(Object.keys(entry.properties).sort()).toEqual(WIRE_KEYS);
	const wire = JSON.stringify(entry);
	for (const forbidden of [
		homedir(),
		userInfo().username,
		hostname(),
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
	expect(list.map((exception) => exception.value)).toEqual(["request project.open", ""]);
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

test("localizable errors report the code but never their display parameters", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	reportError(
		new CodedError("NOT_GIT", "Not a git repository: private-project", {
			path: "/Users/private-owner/private-project",
		}),
		{ source: "request", handled: true, requestMethod: "project.open" },
	);
	await shutdownAnalytics();
	const entries = exceptions(sent);
	expect(entries).toHaveLength(1);
	const wire = JSON.stringify(entries);
	for (const forbidden of [
		"errorParams",
		"private-owner",
		"private-project",
		"Not a git repository",
	]) {
		expect(wire).not.toContain(forbidden);
	}
	expect(entries[0]?.properties.code).toBe("NOT_GIT");
	expect(entries[0]?.properties.$exception_list).toEqual(
		expect.arrayContaining([expect.objectContaining({ value: "request project.open NOT_GIT" })]),
	);
});

test("third-party diagnostics in a message never leave the host", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	const hook = Object.assign(new Error("Confidential client Jane Doe exceeded credit limit"), {
		code: "PUSH_AUTH_FAILED",
	});
	reportError(hook, { source: "request", handled: true, requestMethod: "pr.open" });
	reportError(new Error("getaddrinfo ENOTFOUND llm.acme-corp.internal"), {
		source: "host_logged",
		handled: true,
		scope: "agent",
	});
	await shutdownAnalytics();
	const wire = JSON.stringify(exceptions(sent));
	for (const forbidden of ["Confidential", "Jane", "credit", "acme", "ENOTFOUND"]) {
		expect(wire).not.toContain(forbidden);
	}
	expect(
		exceptions(sent)
			.map((entry) => (entry.properties.$exception_list as Array<{ value: string }>)[0]?.value)
			.sort(),
	).toEqual(["host_logged agent", "request pr.open PUSH_AUTH_FAILED"]);
});

test("message lines shaped like stack frames never become frames, causes and binary remaps included", async () => {
	const sent: BatchEntry[] = [];
	boot(sent, { remapBase: "apps/cli" });
	const hook = [
		"pre-push hook failed",
		"    at calculateCustomerSalary (http://localhost:5173/src/customer-payroll.js:7:2)",
		"    at payrollRun (src/payroll-secret.ts:3:1)",
	].join("\n");
	reportError(new Error(hook, { cause: new Error(hook) }), {
		source: "request",
		handled: true,
		requestMethod: "pr.open",
	});
	await shutdownAnalytics();
	const wire = JSON.stringify(exceptions(sent));
	for (const forbidden of ["calculateCustomerSalary", "customer-payroll", "payroll", "pre-push"]) {
		expect(wire).not.toContain(forbidden);
	}
	expect(wire).toContain("packages/server/src/analytics/errorReports.test.ts");
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

function raise(message: string): Error {
	return new Error(message);
}

test("reports from one throw site are deduplicated whatever their message", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	for (let i = 0; i < 5; i++) {
		reportError(raise(`ENOENT: no such file, open '/Users/jane/p${i}/x'`), {
			source: "request",
			handled: true,
			requestMethod: "fs.read",
		});
	}
	reportError(raise("other"), { source: "request", handled: true, requestMethod: "fs.write" });
	await shutdownAnalytics();
	expect(exceptions(sent).map((entry) => entry.properties.request_method)).toEqual([
		"fs.read",
		"fs.write",
	]);
});

test("each source has its own budget inside the per-launch cap", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	for (let i = 0; i < 80; i++)
		reportError(raise("ui"), { source: "ui", handled: false, scope: `s${i}` });
	reportError(raise("request"), {
		source: "request",
		handled: true,
		requestMethod: "project.open",
	});
	for (let i = 0; i < 80; i++) {
		reportError(raise("logged"), { source: "host_logged", handled: true, scope: `l${i}` });
	}
	reportError(raise("desktop"), { source: "desktop", handled: true, scope: "updates" });
	await shutdownAnalytics();
	const bySource = new Map<unknown, number>();
	for (const entry of exceptions(sent)) {
		bySource.set(entry.properties.source, (bySource.get(entry.properties.source) ?? 0) + 1);
	}
	expect(Object.fromEntries(bySource)).toEqual({ ui: 50, request: 1, host_logged: 49 });
});

test("a fatal report is sent immediately as level fatal, tagged with its crash kind and code", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	const error = Object.assign(new Error("exploded"), { code: "ENOENT" });
	await reportFatalError(error, "unhandledRejection");
	const [entry] = exceptions(sent);
	expect(entry?.properties).toMatchObject({
		source: "host_crash",
		scope: "unhandledRejection",
		handled: false,
		code: "ENOENT",
		$exception_level: "fatal",
	});
	const [root] = entry?.properties.$exception_list as Array<Record<string, unknown>>;
	expect(root?.value).toBe("host_crash unhandledRejection ENOENT");
	expect(root?.mechanism).toMatchObject({ handled: false, type: "onunhandledrejection" });
});

test("an unreachable collector delays a fatal report's exit by at most one second", async () => {
	const sent: BatchEntry[] = [];
	boot(sent, {
		fetchImpl: (() => new Promise<Response>(() => {})) as unknown as typeof fetch,
	});
	const started = performance.now();
	await reportFatalError(new Error("stuck"), "uncaughtException");
	const waited = performance.now() - started;
	expect(waited).toBeGreaterThanOrEqual(900);
	expect(waited).toBeLessThan(1_500);
});

test("client errors keep WebKit stacks parseable and their frames web-relative", async () => {
	const sent: BatchEntry[] = [];
	boot(sent);
	reportClientError({
		kind: "render",
		boundary: "plan rail",
		type: "TypeError",
		stack: "render@http://127.0.0.1:4317/assets/index-abc.js:10:5\nhttps://evil.example/x.js:1:1",
	});
	reportClientError({ kind: "bogus", type: 42, stack: { jane: true } });
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
	expect(list[0]?.value).toBe("ui render:plan_rail");
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
	reportClientError({ kind: "window", type: "TypeError", stack: "" });
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
