import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { InMemoryCredentialStore, type TranscriptContext } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionContext,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { SessionRef } from "@thinkrail/ext";
import { createDelegationService, type DelegationService } from "pi-delegation";
import { createExtHost } from "./index";

const REPO = resolve(import.meta.dir, "../../../..");
const EXT = "ultracode";

const faux = createFauxCore({
	provider: "uc-faux",
	api: "uc-faux",
	models: [
		{
			id: "uc-faux",
			name: "uc-faux",
			reasoning: false,
			input: ["text"],
			cost: { input: 1_000, output: 1_000, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		},
	],
	tokensPerSecond: 100_000,
});

const lastUserText = (context: TranscriptContext) => {
	const message = context.messages.findLast((each) => each.role === "user");
	if (message?.role !== "user") return "";
	return typeof message.content === "string"
		? message.content
		: message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
};

const waitAbortable = (ms: number, signal: AbortSignal | undefined) =>
	new Promise<void>((done) => {
		const timer = setTimeout(done, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			done();
		});
	});

const prompts: string[] = [];

const router = async (context: TranscriptContext, options?: { signal?: AbortSignal }) => {
	const text = lastUserText(context);
	prompts.push(text);
	if (text.includes("SLOW")) await waitAbortable(5_000, options?.signal);
	const word = /WORD (\w+)/.exec(text)?.[1];
	if (word === "bad" && !text.includes("could not be used")) return fauxAssistantMessage("no json");
	if (word) return fauxAssistantMessage(JSON.stringify({ word: word.toUpperCase() }));
	const scan = /SCAN (\w+)/.exec(text)?.[1];
	if (scan) return fauxAssistantMessage(`scanned-${scan}`);
	const fix = /FIX (\S+)/.exec(text)?.[1];
	if (fix) return fauxAssistantMessage(`fixed-${fix}`);
	return fauxAssistantMessage("ok");
};

const SCRIPT = `
export const meta = {
  name: 'sweep',
  description: 'parallel + pipeline + schema',
  phases: [{ title: 'Ask', detail: 'structured answers' }, { title: 'Fix' }],
}
const WORD = { type: 'object', required: ['word'], additionalProperties: false, properties: { word: { type: 'string' } } }
phase('Ask')
const words = await parallel(args.words.map((w) => () =>
  agent('WORD ' + w, { label: 'ask:' + w, schema: WORD, tools: [], model: 'uc-faux' })))
phase('Fix')
const fixed = await pipeline(args.files,
  (file) => agent('SCAN ' + file, { label: 'scan:' + file }),
  (scan, file) => agent('FIX ' + scan, { label: 'fix:' + file }))
log('done ' + words.length)
return { words: words.map((w) => w.word), fixed }
`;

const SLOW_SCRIPT = `
export const meta = { name: 'slow', description: 'cancel me' }
const out = await parallel([1, 2, 3].map((n) => () => agent('SLOW ' + n, { label: 'slow:' + n })))
return out
`;

const ORPHAN_SCRIPT = `
export const meta = { name: 'orphan', description: 'throws with an agent in flight' }
const slow = agent('SLOW 9', { label: 'orphan' })
await agent('SCAN a', { label: 'quick' })
throw new Error('boom')
`;

let root: string;
let base: string;
let runtime: ModelRuntime;
let parent: AgentSession;
let service: DelegationService;
let host: ReturnType<typeof createExtHost>;
const saved: Record<string, string | undefined> = {};

const setEnv = (key: string, value: string) => {
	saved[key] = process.env[key];
	process.env[key] = value;
};

beforeAll(async () => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "ultracode-ext-")));
	setEnv("PI_CODING_AGENT_DIR", join(root, "agentdir"));
	setEnv("PI_OFFLINE", "1");
	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("uc-faux", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: faux.models.map((model) => ({ ...model })),
	});
});

afterAll(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

const startParent = async (cwd: string) => {
	const settingsManager = SettingsManager.inMemory();
	const agentDir = join(base, ".pi-agent");
	mkdirSync(agentDir, { recursive: true });
	const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
	await resourceLoader.reload();
	const model = runtime.getModel("uc-faux", "uc-faux");
	if (!model) throw new Error("faux model missing");
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model,
		modelRuntime: runtime,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
	});
	return session;
};

const makeHost = () => {
	const sessions = (): SessionRef[] => [
		{ sessionId: parent.sessionId, workspaceId: "w1", title: "parent", isStreaming: true },
	];
	return createExtHost({
		userDir: join(base, "user"),
		storeDir: join(base, "store"),
		sessions: {
			list: sessions,
			get: (id) => sessions().find((ref) => ref.sessionId === id),
			stats: () => ({}) as never,
		},
		agents: { serviceFor: (id) => (id === parent.sessionId ? service : undefined) },
	});
};

beforeEach(async () => {
	base = mkdtempSync(join(root, "case-"));
	setEnv("THINKRAIL_DATA_DIR", join(base, "data"));
	const cwd = join(base, "repo");
	mkdirSync(cwd);
	prompts.length = 0;
	faux.setResponses(Array.from({ length: 60 }, () => router));
	parent = await startParent(cwd);
	service = createDelegationService({
		resolveParent: (id) =>
			id === parent.sessionId
				? { cwd, model: parent.model, thinkingLevel: parent.thinkingLevel }
				: undefined,
		delegationRoot: join(base, "delegation"),
		scope: "w1",
		modelRuntime: runtime,
	});
	host = makeHost();
	await host.setProjectRoots([{ projectId: "repo", path: REPO }]);
	expect(host.get(EXT)).toMatchObject({ status: "active" });
});

afterEach(async () => {
	await host.dispose();
	await service.disposeChildrenOf(parent.sessionId);
	parent.dispose();
	faux.setResponses([]);
});

interface Summary {
	runId: string;
	status: string;
	counts: {
		total: number;
		done: number;
		failed: number;
		aborted: number;
		replayed: number;
		running: number;
	};
	cost: number;
}

interface ToolOutput {
	content: Array<{ type: string; text?: string }>;
	details: Summary;
}

const toolOf = (current: ReturnType<typeof makeHost>) => {
	const factory = current.piFactories().find((each) => current.piFactoryOwner(each) === EXT);
	if (!factory) throw new Error("ultracode registered no pi factory");
	let tool: ToolDefinition | undefined;
	const pi = {
		registerTool: (definition: ToolDefinition) => {
			tool = definition;
		},
		on: () => {},
	};
	void factory(pi as unknown as ExtensionAPI);
	if (!tool) throw new Error("no Ultracode tool");
	return tool;
};

const toolCtx = () =>
	({
		cwd: join(base, "repo"),
		sessionManager: parent.sessionManager,
		modelRegistry: { getAll: () => runtime.getModels() },
	}) as unknown as ExtensionContext;

const callTool = async (
	params: Record<string, unknown>,
	options: { signal?: AbortSignal; updates?: unknown[] } = {},
) => {
	const output: unknown = await toolOf(host).execute(
		"call-1",
		params as never,
		options.signal,
		(update) => options.updates?.push(update),
		toolCtx(),
	);
	return output as ToolOutput;
};

const textOf = (output: ToolOutput) => output.content[0]?.text ?? "";

const snapshot = (key: string) => host.snapshot([`${EXT}:${key}`])[`${EXT}:${key}`];

const until = async (check: () => boolean, tries = 400) => {
	for (let i = 0; i < tries && !check(); i++) await Bun.sleep(10);
	expect(check()).toBe(true);
};

describe("ultracode example extension", () => {
	test("runs parallel, pipeline and schema agents as delegation children with pi's usage", async () => {
		const output = await callTool({
			script: SCRIPT,
			args: { words: ["alpha", "bad"], files: ["a", "b"] },
			concurrency: 3,
		});
		const text = textOf(output);
		expect(output.details).toMatchObject({
			status: "completed",
			counts: { total: 6, done: 6, failed: 0 },
		});
		expect(text).toContain('Workflow "sweep" completed — 6 agents');
		expect(text).toContain('"ALPHA"');
		expect(text).toContain('"fixed-scanned-a"');
		expect(text).toContain('"fixed-scanned-b"');
		expect(prompts.filter((prompt) => prompt.includes("could not be used"))).toHaveLength(1);
		expect(service.childrenOf(parent.sessionId)).toEqual([]);

		const runs = snapshot("runs") as Summary[];
		expect(runs[0]).toMatchObject({ runId: output.details.runId, status: "completed" });
		const stored = JSON.parse(readFileSync(join(base, "store", `${EXT}.json`), "utf8"));
		const run = stored.runs[0];
		expect(run.phases.map((phase: { title: string }) => phase.title)).toEqual(["Ask", "Fix"]);
		expect(run.phases[0].detail).toBe("structured answers");
		const bad = run.agents.find((agent: { label: string }) => agent.label === "ask:bad");
		expect(bad).toMatchObject({ state: "done", attempt: 2, result: { word: "BAD" } });
		expect(bad.model).toBe("uc-faux/uc-faux");
		expect(bad.childId).toBeString();
		expect(bad.usage.turns).toBe(2);
		expect(run.agents.every((agent: { usage: { output: number } }) => agent.usage.output > 0)).toBe(
			true,
		);
		const journal = join(base, "data", "ultracode", "runs", output.details.runId, "journal.jsonl");
		expect(existsSync(journal)).toBe(true);

		const before = prompts.length;
		const resumed = await callTool({
			script: SCRIPT,
			args: { words: ["alpha", "bad"], files: ["a", "b"] },
			resumeFromRunId: output.details.runId,
		});
		expect(resumed.details).toMatchObject({
			status: "completed",
			counts: { total: 6, replayed: 6 },
			cost: 0,
		});
		expect(prompts.length).toBe(before);
		expect(textOf(resumed)).toContain(`resumed from ${output.details.runId}`);
	});

	test("the cancel action cancels every child through its handle", async () => {
		const updates: unknown[] = [];
		const running = callTool({ script: SLOW_SCRIPT }, { updates });
		await until(() => {
			const runs = snapshot("runs") as Summary[] | undefined;
			return (
				(runs?.[0]?.counts.total ?? 0) === 3 && service.childrenOf(parent.sessionId).length === 3
			);
		});
		await until(() => updates.length > 0);
		expect(updates.at(-1)).toMatchObject({ details: { status: "running", counts: { total: 3 } } });
		const runId = (snapshot("runs") as Summary[])[0]?.runId;
		const reply = await host.invokeAction({ ext: EXT, id: "cancel", payload: { runId }, ctx: {} });
		expect(reply).toEqual({ cancelled: true });
		const output = await running;
		expect(output.details).toMatchObject({ status: "aborted", counts: { total: 3, aborted: 3 } });
		expect(service.childrenOf(parent.sessionId)).toEqual([]);
		const journal = readFileSync(
			join(base, "data", "ultracode", "runs", output.details.runId, "journal.jsonl"),
			"utf8",
		);
		expect(journal).not.toContain('"type":"result"');
	});

	test("unloading the extension cancels a running workflow", async () => {
		const running = callTool({ script: SLOW_SCRIPT });
		await until(() => service.childrenOf(parent.sessionId).length === 3);
		const startedAt = Date.now();
		await host.dispose();
		expect(Date.now() - startedAt).toBeLessThan(3_000);
		const output = await running;
		expect(output.details.status).toBe("aborted");
		expect(service.childrenOf(parent.sessionId)).toEqual([]);

		host = makeHost();
		await host.setProjectRoots([{ projectId: "repo", path: REPO }]);
		expect(snapshot("runs")).toMatchObject([{ runId: output.details.runId, status: "aborted" }]);
		expect(
			existsSync(join(base, "data", "ultracode", "runs", output.details.runId, "script.js")),
		).toBe(true);
	});

	test("a reload keeps the aborted run listed with its journal", async () => {
		const running = callTool({ script: SLOW_SCRIPT });
		await until(() => service.childrenOf(parent.sessionId).length === 3);
		await host.reload(EXT);
		const output = await running;
		const aborted = output.details.runId;
		expect(output.details.status).toBe("aborted");
		const listed = () =>
			((snapshot("runs") as Summary[] | undefined) ?? []).map((run) => run.runId);
		await until(() => listed().includes(aborted));

		const next = await callTool({ script: SCRIPT, args: { words: ["alpha"], files: ["a"] } });
		expect(listed()).toEqual([next.details.runId, aborted]);
		const stored = JSON.parse(readFileSync(join(base, "store", `${EXT}.json`), "utf8"));
		expect(stored.runs.map((run: { runId: string }) => run.runId)).toEqual([
			next.details.runId,
			aborted,
		]);
		expect(existsSync(join(base, "data", "ultracode", "runs", aborted, "script.js"))).toBe(true);
	});

	test("agents still in flight when the script ends are cancelled", async () => {
		const output = await callTool({ script: ORPHAN_SCRIPT });
		expect(output.details).toMatchObject({
			status: "failed",
			counts: { total: 2, done: 1, aborted: 1, running: 0 },
		});
		expect(service.childrenOf(parent.sessionId)).toEqual([]);
		const stored = JSON.parse(readFileSync(join(base, "store", `${EXT}.json`), "utf8"));
		const orphan = stored.runs[0].agents.find(
			(agent: { label: string }) => agent.label === "orphan",
		);
		expect(orphan.state).toBe("aborted");
	});

	test("refuses a bad script, a bad schema and an unknown resume before any child runs", async () => {
		await expect(callTool({ script: "return 1" })).rejects.toThrow("export const meta");
		await expect(callTool({ script: SCRIPT, resumeFromRunId: "uc_missing" })).rejects.toThrow(
			"Cannot resume uc_missing",
		);
		const badSchema = await callTool({
			script: `export const meta = { name: 'x', description: 'y' }
return await agent('WORD a', { schema: { type: 'object', nullable: true } })`,
		});
		expect(badSchema.details.status).toBe("failed");
		expect(textOf(badSchema)).toContain('unsupported keyword "nullable"');
		expect(prompts).toEqual([]);
	});
});
