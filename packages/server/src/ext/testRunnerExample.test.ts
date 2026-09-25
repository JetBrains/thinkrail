import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionRef, WorkspaceRef } from "@thinkrail/ext";
import { createExtHost } from "./index";

const REPO = resolve(import.meta.dir, "../../../..");
const EXT = "test-runner";

interface Failure {
	name: string;
	file?: string;
	line?: number;
	error: string;
}

interface RunResult {
	command: string;
	filter?: string;
	by: string;
	outcome: string;
	source: string;
	counts: { pass: number; fail: number; skip: number };
	failures: Failure[];
	failuresTotal: number;
	output: string;
	message?: string;
	startedAt: number;
}

interface TestsState {
	runner: { state: string; label?: string; structured?: boolean; message?: string };
	running?: { command: string; by: string; lastLine: string };
	last?: RunResult;
}

const MIXED = `import { describe, expect, test } from "bun:test";
describe("math", () => {
	test("adds", () => expect(1 + 1).toBe(2));
	test("compares objects", () => expect({ a: 1 }).toEqual({ a: 2 }));
	test.skip("skipped", () => {});
	test.todo("later");
});
test("throws <here>", () => {
	throw new Error("boom & bust");
});
`;

const PASSING = `import { expect, test } from "bun:test";
test("ok", () => expect(true).toBe(true));
`;

const SLOW = `import { test } from "bun:test";
test("slow", async () => {
	await Bun.sleep(30_000);
}, 60_000);
`;

let base: string;
let bunDefault: string;
let consoleScript: string;
let broken: string;
let slow: string;

const write = (dir: string, files: Record<string, string>) => {
	mkdirSync(dir, { recursive: true });
	for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
};

beforeAll(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "test-runner-ext-")));
	bunDefault = join(base, "bun-default");
	consoleScript = join(base, "console-script");
	broken = join(base, "broken");
	slow = join(base, "slow");
	write(bunDefault, { "mixed.test.ts": MIXED, "passing.test.ts": PASSING });
	write(consoleScript, {
		"package.json": JSON.stringify({ scripts: { test: "bun test && echo all-done" } }),
		"mixed.test.ts": MIXED,
	});
	write(broken, { "package.json": "{ not json" });
	write(slow, { "slow.test.ts": SLOW });
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const workspaces = (): WorkspaceRef[] =>
	[
		["w1", bunDefault],
		["w2", consoleScript],
		["w3", broken],
		["w4", slow],
		["w5", join(base, "missing")],
	].map(([workspaceId = "", path = ""]) => ({
		workspaceId,
		projectId: "p1",
		name: workspaceId,
		branch: "main",
		path,
	}));

const sessions: SessionRef[] = [];

const makeHost = () =>
	createExtHost({
		userDir: join(base, "user"),
		storeDir: join(base, "store"),
		sessions: {
			list: () => sessions,
			get: (id) => sessions.find((session) => session.sessionId === id),
			stats: () => ({}) as never,
		},
		workspaces: {
			list: workspaces,
			get: (id) => workspaces().find((each) => each.workspaceId === id),
		},
	});

type Host = ReturnType<typeof makeHost>;

const key = (workspaceId: string) => `${EXT}:tests:${workspaceId}`;

const stateOf = (host: Host, workspaceId: string) =>
	host.snapshot([key(workspaceId)])[key(workspaceId)] as TestsState | undefined;

const until = async (check: () => boolean, tries = 1_500) => {
	for (let i = 0; i < tries && !check(); i++) await Bun.sleep(10);
	expect(check()).toBe(true);
};

const action = (host: Host, id: string, workspaceId: string, payload?: unknown) =>
	host.invokeAction({ ext: EXT, id, payload, ctx: { workspaceId } });

const finished = async (host: Host, workspaceId: string, since: number) => {
	await until(() => {
		const state = stateOf(host, workspaceId);
		return !state?.running && (state?.last?.startedAt ?? 0) >= since;
	});
	const last = stateOf(host, workspaceId)?.last;
	if (!last) throw new Error("no result");
	return last;
};

const load = async () => {
	const host = makeHost();
	await host.setProjectRoots([{ projectId: "repo", path: REPO }]);
	expect(host.get(EXT)).toMatchObject({ status: "active" });
	return host;
};

let host: Host;

beforeAll(async () => {
	host = await load();
}, 60_000);

afterAll(() => host.dispose());

describe("test-runner example extension", () => {
	test("validates: manifest, both views build, dry factory run", async () => {
		expect(await host.validate(EXT)).toMatchObject({ ok: true });
	}, 60_000);

	test("publishes nothing until a view watches, then the detected runner", async () => {
		expect(stateOf(host, "w1")).toBeUndefined();
		host.setWatched("c1", [key("w1"), key("w2"), key("w3"), key("w4"), key("w5")]);
		await until(() => stateOf(host, "w1") !== undefined);
		expect(stateOf(host, "w1")).toEqual({
			runner: { state: "ready", label: "bun test", structured: true },
		});
		expect(stateOf(host, "w2")?.runner).toEqual({
			state: "ready",
			label: "bun run test (bun test && echo all-done)",
			structured: false,
		});
		expect(stateOf(host, "w3")?.runner.state).toBe("error");
		expect(stateOf(host, "w3")?.runner.message).toContain("package.json is not valid JSON");
		expect(stateOf(host, "w5")?.runner.message).toContain("does not exist");
	});

	test("a panel run parses the JUnit report: counts, nested names, locations, errors", async () => {
		const since = Date.now();
		expect(await action(host, "run", "w1")).toEqual({ started: true });
		const last = await finished(host, "w1", since);
		expect(last).toMatchObject({
			command: "bun test",
			by: "panel",
			outcome: "failed",
			source: "junit",
			counts: { pass: 2, fail: 2, skip: 2 },
			failuresTotal: 2,
		});
		const names = last.failures.map((failure) => failure.name).sort();
		expect(names).toEqual(["math > compares objects", "throws <here>"]);
		const compare = last.failures.find((failure) => failure.name === "math > compares objects");
		expect(compare).toMatchObject({ file: "mixed.test.ts", line: 4 });
		expect(compare?.error).toContain("toEqual");
		expect(last.failures.find((failure) => failure.name === "throws <here>")?.error).toContain(
			"boom & bust",
		);
	}, 60_000);

	test("a filter narrows the run to matching files and a flag-like filter is refused", async () => {
		const since = Date.now();
		expect(await action(host, "run", "w1", { filter: "passing" })).toEqual({ started: true });
		const last = await finished(host, "w1", since);
		expect(last).toMatchObject({
			command: "bun test passing",
			outcome: "passed",
			counts: { pass: 1, fail: 0, skip: 0 },
			failures: [],
		});
		expect(await action(host, "run", "w1", { filter: "--preload ./evil.ts" })).toEqual({
			started: false,
			reason: 'filter part "--preload" looks like a flag',
		});
	}, 60_000);

	test("a script that is not a plain runner falls back to console parsing", async () => {
		const since = Date.now();
		expect(await action(host, "run", "w2")).toEqual({ started: true });
		const last = await finished(host, "w2", since);
		expect(last).toMatchObject({
			command: "bun run test",
			outcome: "failed",
			source: "console",
			counts: { pass: 1, fail: 2, skip: 2 },
			failuresTotal: 2,
		});
		expect(last.failures.map((failure) => failure.name).sort()).toEqual([
			"math > compares objects",
			"throws <here>",
		]);
		expect(last.failures[0]?.file).toBe("mixed.test.ts");
		expect(last.failures.find((failure) => failure.name === "throws <here>")?.error).toContain(
			"boom & bust",
		);
	}, 60_000);

	test("uses the host's own bun when PATH has none, also inside the test script", async () => {
		const path = process.env.PATH;
		process.env.PATH = "/usr/bin:/bin";
		try {
			const since = Date.now();
			expect(await action(host, "run", "w2")).toEqual({ started: true });
			const last = await finished(host, "w2", since);
			expect(last).toMatchObject({ outcome: "failed", counts: { pass: 1, fail: 2, skip: 2 } });
		} finally {
			process.env.PATH = path;
		}
	}, 60_000);

	test("an invalid package.json or a missing directory refuses to run", async () => {
		expect(await action(host, "run", "w3")).toMatchObject({ started: false });
		expect(await action(host, "run", "w5")).toMatchObject({ started: false });
	});

	test("one run per workspace; cancel stops the process group", async () => {
		expect(await action(host, "run", "w4")).toEqual({ started: true });
		await until(() => stateOf(host, "w4")?.running !== undefined);
		expect(await action(host, "run", "w4")).toEqual({
			started: false,
			reason: "Tests are already running.",
		});
		const startedAt = Date.now();
		expect(await action(host, "cancel", "w4")).toEqual({ cancelled: true });
		const last = await finished(host, "w4", startedAt - 60_000);
		expect(last.outcome).toBe("cancelled");
		expect(Date.now() - startedAt).toBeLessThan(10_000);
		expect(await action(host, "cancel", "w4")).toEqual({ cancelled: false });
	}, 30_000);

	test("the last result survives a new host and is published on watch", async () => {
		const next = await load();
		try {
			next.setWatched("c9", [key("w1")]);
			await until(() => stateOf(next, "w1")?.last !== undefined);
			expect(stateOf(next, "w1")?.last).toMatchObject({ command: "bun test passing" });
		} finally {
			await next.dispose();
		}
	}, 60_000);

	test("the last view leaving drops the channel", async () => {
		host.setWatched("c1", []);
		await until(() => stateOf(host, "w1") === undefined);
	});

	test("a real pi session calls run_tests and gets a compact summary", async () => {
		const factory = host.piFactories().find((candidate) => host.piFactoryOwner(candidate) === EXT);
		if (!factory) throw new Error("test-runner registered no pi factory");
		const agentDir = join(base, ".pi-agent");
		mkdirSync(agentDir, { recursive: true });
		const faux = createFauxCore({
			provider: "tests-probe",
			api: "tests-probe",
			tokensPerSecond: 100_000,
		});
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
		});
		runtime.registerProvider("tests-probe", {
			api: faux.api,
			baseUrl: "http://faux.local",
			apiKey: "faux",
			streamSimple: faux.streamSimple,
			models: faux.models.map((model) => ({ ...model })),
		});
		const settingsManager = SettingsManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd: bunDefault,
			agentDir,
			settingsManager,
			extensionFactories: [factory],
		});
		await resourceLoader.reload();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("run_tests", { filter: "mixed" }, { id: "tests" })]),
			fauxAssistantMessage("done"),
		]);
		const { session } = await createAgentSession({
			cwd: bunDefault,
			agentDir,
			model: faux.getModel(),
			modelRuntime: runtime,
			settingsManager,
			resourceLoader,
			sessionManager: SessionManager.inMemory(bunDefault),
		});
		sessions.push({
			sessionId: session.sessionId,
			workspaceId: "w1",
			title: "tests",
			isStreaming: true,
		});
		host.setWatched("c2", [key("w1")]);
		try {
			await session.prompt("run the tests");
			const message = session.messages.find(
				(each) => each.role === "toolResult" && each.toolCallId === "tests",
			);
			if (message?.role !== "toolResult") throw new Error("no tool result");
			const text = message.content
				.map((block) => (block.type === "text" ? block.text : ""))
				.join("");
			expect(message.isError).toBe(false);
			expect(text).toStartWith("Failed: 1 passed, 2 failed, 2 skipped in");
			expect(text).toContain("Command: bun test mixed");
			expect(text).toContain("- math > compares objects (mixed.test.ts:4)");
			expect(text).toContain("boom & bust");
			expect(text.length).toBeLessThanOrEqual(4_000);
			expect(message.details).toMatchObject({ by: "agent", outcome: "failed" });
			await until(() => stateOf(host, "w1")?.last?.by === "agent");
		} finally {
			session.dispose();
			host.setWatched("c2", []);
		}
	}, 60_000);
});
