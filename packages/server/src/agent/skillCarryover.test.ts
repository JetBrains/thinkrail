import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type { Message } from "@thinkrail/contracts";
import {
	carryoverBudget,
	compactedSkills,
	SKILL_CARRYOVER_CUSTOM_TYPE,
	SKILL_CARRYOVER_PREAMBLE,
	skillCarryover,
	skillCarryoverText,
	withSkillCarryover,
} from "./skillCarryover";

const user = (text: string): Message =>
	({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }) as Message;

const assistant = (content: unknown[]): Message =>
	({
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		stopReason: "toolUse",
		timestamp: Date.now(),
	}) as unknown as Message;

const readCall = (
	id: string,
	path: string,
	window: { offset?: number; limit?: number } = {},
): Message => assistant([{ type: "toolCall", id, name: "read", arguments: { path, ...window } }]);

const readResult = (
	toolCallId: string,
	text: string,
	isError = false,
	details?: unknown,
): Message =>
	({
		role: "toolResult",
		toolCallId,
		toolName: "read",
		content: [{ type: "text", text }],
		details,
		isError,
		timestamp: Date.now(),
	}) as unknown as Message;

const skill = (name: string): Skill =>
	({
		name,
		description: name,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
	}) as Skill;

const LEDGER = skill("ledger");
const TODOS = skill("todos");
const SKILLS = [LEDGER, TODOS];

const skillBlock = (name: string) =>
	`<skill name="${name}" location="/skills/${name}/SKILL.md">\nbody\n</skill>\n\ngo`;

function session(): SessionManager {
	return SessionManager.inMemory("/repo");
}

test("skills loaded before the cut by /skill: or by reading their file are restored, oldest first", () => {
	const sm = session();
	sm.appendMessage(user(skillBlock("ledger")));
	sm.appendMessage(readCall("r1", "../skills/todos/SKILL.md"));
	sm.appendMessage(readResult("r1", "Plan with todo_write."));
	const kept = sm.appendMessage(user("next"));
	sm.appendCompaction("summary", kept, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([LEDGER, TODOS]);
});

test("a skill whose latest load is in the kept tail or after the compaction is not restored", () => {
	const sm = session();
	sm.appendMessage(user(skillBlock("ledger")));
	sm.appendMessage(user(skillBlock("todos")));
	const kept = sm.appendMessage(user(skillBlock("ledger")));
	sm.appendCompaction("summary", kept, 100);
	sm.appendMessage(user(skillBlock("todos")));

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([]);
});

test("reads of unloaded SKILL.md files, failed reads and sessions without compaction restore nothing", () => {
	const sm = session();
	sm.appendMessage(readCall("r1", "/repo/packages/foo/skills/draft/SKILL.md"));
	sm.appendMessage(readResult("r1", "draft"));
	sm.appendMessage(readCall("r2", "/skills/ledger/SKILL.md"));
	sm.appendMessage(readResult("r2", "ENOENT", true));
	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([]);

	const kept = sm.appendMessage(user("next"));
	sm.appendCompaction("summary", kept, 100);
	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([]);
});

test("a read reaches its skill through pi's @ prefix, ~ expansion, file URLs and symlinks", () => {
	const root = mkdtempSync(join(tmpdir(), "skill-carryover-"));
	try {
		mkdirSync(join(root, "real", "ledger"), { recursive: true });
		writeFileSync(join(root, "real", "ledger", "SKILL.md"), "body");
		symlinkSync(join(root, "real"), join(root, "linked"));
		const linked: Skill = {
			...LEDGER,
			filePath: join(root, "linked", "ledger", "SKILL.md"),
			baseDir: join(root, "linked", "ledger"),
		};
		const home: Skill = { ...TODOS, filePath: join(homedir(), "todos", "SKILL.md") };
		const url: Skill = { ...skill("url"), filePath: join(root, "real", "url dir", "SKILL.md") };
		const sm = session();
		sm.appendMessage(readCall("r1", `@${join(root, "real", "ledger", "SKILL.md")}`));
		sm.appendMessage(readResult("r1", "body"));
		sm.appendMessage(readCall("r2", "~/todos/SKILL.md"));
		sm.appendMessage(readResult("r2", "body"));
		sm.appendMessage(readCall("r3", pathToFileURL(url.filePath).href));
		sm.appendMessage(readResult("r3", "body"));
		const kept = sm.appendMessage(user("next"));
		sm.appendCompaction("summary", kept, 100);

		expect(compactedSkills(sm.getBranch(), [linked, home, url], "/repo")).toEqual([
			linked,
			home,
			url,
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a partial or truncated read in the kept tail does not hide an earlier complete load", () => {
	const sm = session();
	sm.appendMessage(user(skillBlock("ledger")));
	sm.appendMessage(readCall("r1", "/skills/todos/SKILL.md"));
	sm.appendMessage(readResult("r1", "body"));
	const kept = sm.appendMessage(readCall("r2", "/skills/ledger/SKILL.md", { limit: 1 }));
	sm.appendMessage(readResult("r2", "line"));
	sm.appendMessage(readCall("r3", "/skills/todos/SKILL.md"));
	sm.appendMessage(readResult("r3", "head", false, { truncation: { truncated: true } }));
	sm.appendCompaction("summary", kept, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([LEDGER, TODOS]);
});

test("a skill paginated in before the cut is restored, and a complete load in the kept tail wins", () => {
	const sm = session();
	sm.appendMessage(readCall("r1", "/skills/ledger/SKILL.md", { limit: 10 }));
	sm.appendMessage(readResult("r1", "page 1"));
	sm.appendMessage(readCall("r2", "/skills/ledger/SKILL.md", { offset: 11 }));
	sm.appendMessage(readResult("r2", "page 2"));
	sm.appendMessage(readCall("r3", "/skills/todos/SKILL.md", { limit: 10 }));
	sm.appendMessage(readResult("r3", "page 1"));
	const kept = sm.appendMessage(user(skillBlock("todos")));
	sm.appendCompaction("summary", kept, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([LEDGER]);
});

test("a skill paginated in before the cut survives an excerpt re-read in the kept tail", () => {
	const sm = session();
	sm.appendMessage(readCall("r1", "/skills/ledger/SKILL.md", { limit: 10 }));
	sm.appendMessage(readResult("r1", "page 1"));
	sm.appendMessage(readCall("r2", "/skills/ledger/SKILL.md", { offset: 11 }));
	sm.appendMessage(readResult("r2", "page 2"));
	sm.appendMessage(readCall("r3", "/skills/todos/SKILL.md"));
	sm.appendMessage(readResult("r3", "head", false, { truncation: { truncated: true } }));
	const kept = sm.appendMessage(readCall("r4", "/skills/ledger/SKILL.md", { limit: 1 }));
	sm.appendMessage(readResult("r4", "line"));
	sm.appendMessage(readCall("r5", "/skills/todos/SKILL.md", { offset: 2 }));
	sm.appendMessage(readResult("r5", "rest"));
	sm.appendCompaction("summary", kept, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([LEDGER, TODOS]);
});

test("only a complete load at or after the cut suppresses restoring a compacted skill", () => {
	const sm = session();
	sm.appendMessage(readCall("r1", "/skills/ledger/SKILL.md", { limit: 10 }));
	sm.appendMessage(readResult("r1", "page 1"));
	sm.appendMessage(user(skillBlock("todos")));
	const kept = sm.appendMessage(readCall("r2", "/skills/ledger/SKILL.md", { offset: 11 }));
	sm.appendMessage(readResult("r2", "page 2"));
	sm.appendMessage(readCall("r3", "/skills/ledger/SKILL.md"));
	sm.appendMessage(readResult("r3", "body"));
	sm.appendMessage(readCall("r4", "/skills/todos/SKILL.md", { limit: 1 }));
	sm.appendMessage(readResult("r4", "line"));
	sm.appendCompaction("summary", kept, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([TODOS]);
});

test("a partial read only in the kept tail or a failed excerpt is no evidence of a compacted load", () => {
	const sm = session();
	sm.appendMessage(readCall("r1", "/skills/ledger/SKILL.md", { limit: 10 }));
	sm.appendMessage(readResult("r1", "EISDIR", true));
	const kept = sm.appendMessage(readCall("r2", "/skills/todos/SKILL.md", { limit: 1 }));
	sm.appendMessage(readResult("r2", "line"));
	sm.appendCompaction("summary", kept, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([]);
});

test("restored skills are ordered by their latest load, a kept-tail excerpt included", () => {
	const sm = session();
	sm.appendMessage(user(skillBlock("ledger")));
	sm.appendMessage(user(skillBlock("todos")));
	const kept = sm.appendMessage(readCall("r1", "/skills/ledger/SKILL.md", { limit: 1 }));
	sm.appendMessage(readResult("r1", "line"));
	sm.appendCompaction("summary", kept, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([TODOS, LEDGER]);
});

test("pages in the kept tail that together show the whole file are not restored twice", () => {
	const sm = session();
	sm.appendMessage(user(skillBlock("ledger")));
	sm.appendMessage(user(skillBlock("todos")));
	const kept = sm.appendMessage(readCall("r1", "/skills/ledger/SKILL.md", { offset: 11 }));
	sm.appendMessage(readResult("r1", "page 2"));
	sm.appendMessage(readCall("r2", "/skills/ledger/SKILL.md", { limit: 10 }));
	sm.appendMessage(readResult("r2", "page 1"));
	sm.appendMessage(readCall("r3", "/skills/todos/SKILL.md"));
	sm.appendMessage(
		readResult("r3", "head", false, { truncation: { truncated: true, outputLines: 12 } }),
	);
	sm.appendMessage(readCall("r4", "/skills/todos/SKILL.md", { offset: 13, limit: 8 }));
	sm.appendMessage(readResult("r4", "tail"));
	sm.appendCompaction("summary", kept, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo", () => 20)).toEqual([]);
});

test("kept-tail pages with a gap, a short end or an oversized first line still restore the skill", () => {
	const sm = session();
	sm.appendMessage(user(skillBlock("ledger")));
	sm.appendMessage(user(skillBlock("todos")));
	const kept = sm.appendMessage(readCall("r1", "/skills/ledger/SKILL.md", { limit: 10 }));
	sm.appendMessage(readResult("r1", "page 1"));
	sm.appendMessage(readCall("r2", "/skills/ledger/SKILL.md", { offset: 12 }));
	sm.appendMessage(readResult("r2", "page 3"));
	sm.appendMessage(readCall("r3", "/skills/todos/SKILL.md", { limit: 19 }));
	sm.appendMessage(readResult("r3", "almost"));
	sm.appendMessage(readCall("r4", "/skills/todos/SKILL.md", { offset: 20 }));
	sm.appendMessage(
		readResult("r4", "[Line 20 is 60KB]", false, {
			truncation: { truncated: true, outputLines: 0, firstLineExceedsLimit: true },
		}),
	);
	sm.appendCompaction("summary", kept, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo", () => 20)).toEqual([LEDGER, TODOS]);
});

test("loads compacted by an earlier compaction stay restored after the next one", () => {
	const sm = session();
	sm.appendMessage(user(skillBlock("ledger")));
	const first = sm.appendMessage(user("next"));
	sm.appendCompaction("first", first, 100);
	const second = sm.appendMessage(user("later"));
	sm.appendCompaction("second", second, 100);

	expect(compactedSkills(sm.getBranch(), SKILLS, "/repo")).toEqual([LEDGER]);
});

const window = (contextWindow: number, api = "anthropic-messages") =>
	({ api, contextWindow }) as Parameters<typeof carryoverBudget>[0];

test("the budget scales with the dispatched model's window and caps per skill and in total", () => {
	expect(carryoverBudget(window(1_000_000))).toEqual({ skillChars: 20_000, totalChars: 100_000 });
	expect(carryoverBudget(window(128_000))).toEqual({ skillChars: 20_000, totalChars: 51_200 });
	expect(carryoverBudget(window(32_000))).toEqual({ skillChars: 12_800, totalChars: 12_800 });
});

test("no budget when the request's capacity is unknown or the selection is a virtual model", () => {
	expect(carryoverBudget(undefined)).toBe(undefined);
	expect(carryoverBudget(window(0))).toBe(undefined);
	expect(carryoverBudget(window(1_000_000, "pi-virtual"))).toBe(undefined);
});

test("the text keeps the newest skills, truncates from the end and fills the budget exactly", () => {
	const bodies = new Map([
		[LEDGER, "a".repeat(30)],
		[TODOS, "b".repeat(30)],
	]);
	const expected = [
		SKILL_CARRYOVER_PREAMBLE,
		`<skill name="ledger" location="/skills/ledger/SKILL.md">\nReferences are relative to /skills/ledger.\n\naaaaa\n\n[Truncated after compaction. Read /skills/ledger/SKILL.md for the full text.]\n</skill>`,
		`<skill name="todos" location="/skills/todos/SKILL.md">\nReferences are relative to /skills/todos.\n\n${"b".repeat(20)}\n\n[Truncated after compaction. Read /skills/todos/SKILL.md for the full text.]\n</skill>`,
	].join("\n\n");
	const budget = { skillChars: 20, totalChars: expected.length };

	expect(skillCarryoverText(SKILLS, budget, (s) => bodies.get(s))).toBe(expected);
	expect(skillCarryoverText(SKILLS, budget, () => undefined)).toBe(undefined);
	expect(skillCarryoverText(SKILLS, { skillChars: 20, totalChars: 25 }, (s) => bodies.get(s))).toBe(
		undefined,
	);
});

test("the whole rendered text stays within the total budget for many skills with long paths", () => {
	const many = Array.from({ length: 100 }, (_, i) => ({
		...skill(`s${i}`),
		filePath: `/${"deep/".repeat(40)}s${i}/SKILL.md`,
		baseDir: `/${"deep/".repeat(40)}s${i}`,
	}));
	const budget = carryoverBudget(window(32_000));
	if (!budget) throw new Error("expected a budget");
	for (const body of ["x".repeat(22), "y".repeat(budget.skillChars * 2)]) {
		const text = skillCarryoverText(many, budget, () => body);
		expect(text?.length).toBeLessThanOrEqual(budget.totalChars);
		expect(text).toContain(`location="${many.at(-1)?.filePath}"`);
	}
});

test("the carry-over goes right after the compaction summary and nowhere without one", () => {
	const summary = { role: "compactionSummary", summary: "s", tokensBefore: 1, timestamp: 7 };
	const next = user("next");
	const messages = withSkillCarryover([summary, next] as never, "restored");

	expect(messages?.map((message) => message.role)).toEqual(["compactionSummary", "custom", "user"]);
	expect(messages?.[1]).toMatchObject({
		customType: SKILL_CARRYOVER_CUSTOM_TYPE,
		content: "restored",
		display: false,
	});
	expect(withSkillCarryover([next] as never, "restored")).toBe(undefined);
	expect(withSkillCarryover([summary] as never, undefined)).toBe(undefined);
});

const MODEL = {
	id: "carryover-probe",
	name: "Skill carry-over probe",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 100,
};

const SMALL_MODEL = { ...MODEL, id: "carryover-small", name: "Small probe", contextWindow: 16_000 };

const RULE = "Every reply ends with ledger-ok.";

type Step = FauxResponseFactory;
type Context = Parameters<Step>[0];

const isSummarizer = (context: Context) =>
	JSON.stringify(context).includes("You are a context summarization assistant");

interface ScenarioOptions {
	reserveTokens?: number;
	keepRecentTokens?: number;
	model?: "default" | "small" | "virtual";
}

interface ScenarioResult {
	requests: string[];
	summarizerCalls: number;
	entries: string[];
	compactions: { reason: string; willRetry: boolean }[];
	lastStopReason: string | undefined;
}

async function runScenario(
	steps: (files: { skillFile: string; bigFile: string }) => Step[],
	drive: (session: AgentSession) => Promise<void>,
	{ reserveTokens = 190_000, keepRecentTokens = 1, model = "default" }: ScenarioOptions = {},
): Promise<ScenarioResult> {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-skill-carryover-"));
	const agentDir = join(cwd, ".pi-agent");
	const skillDir = join(agentDir, "skills", "ledger");
	mkdirSync(skillDir, { recursive: true });
	const skillFile = join(skillDir, "SKILL.md");
	writeFileSync(skillFile, `---\nname: ledger\ndescription: Ledger rules.\n---\n\n${RULE}\n`);
	const bigFile = join(cwd, "big.txt");
	writeFileSync(bigFile, `${"z".repeat(99)}\n`.repeat(400));
	const faux = createFauxCore({
		provider: "carryover-probe",
		api: "carryover-probe",
		models: [MODEL, SMALL_MODEL],
		tokensPerSecond: 1_000_000,
	});
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("carryover-probe", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [MODEL, SMALL_MODEL].map((m) => ({ ...m, api: faux.api })),
	});
	runtime.registerVirtualModel({
		provider: "carryover-router",
		id: "auto",
		name: "Auto",
		contextWindow: 1_000_000,
		route: () => ({
			model: runtime.getModel("carryover-probe", SMALL_MODEL.id) ?? faux.getModel(),
			thinkingLevel: "off",
		}),
	});
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: true, keepRecentTokens, reserveTokens },
		retry: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: [skillCarryover],
	});
	await resourceLoader.reload();
	const requests: string[] = [];
	let summarizerCalls = 0;
	const queue = steps({ skillFile, bigFile });
	const respond: Step = (context, ...rest) => {
		if (isSummarizer(context)) {
			summarizerCalls++;
			return fauxAssistantMessage("## Goal\nWrite files.");
		}
		requests.push(JSON.stringify(context.messages));
		const step = queue.shift();
		return step ? step(context, ...rest) : fauxAssistantMessage("done");
	};
	faux.setResponses(Array.from({ length: 20 }, () => respond));
	const selected = {
		default: faux.getModel(),
		small: runtime.getModel("carryover-probe", SMALL_MODEL.id),
		virtual: runtime.getModel("carryover-router", "auto"),
	}[model];
	if (!selected) throw new Error(`no ${model} model`);
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: selected,
		modelRuntime: runtime,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
	});
	const compactions: ScenarioResult["compactions"] = [];
	session.subscribe((event) => {
		if (event.type === "compaction_end")
			compactions.push({ reason: event.reason, willRetry: event.willRetry });
	});
	try {
		await drive(session);
		const entries = session.sessionManager.getBranch().map((entry) => entry.type);
		const last = session.messages.findLast((message) => message.role === "assistant");
		const lastStopReason = last?.role === "assistant" ? last.stopReason : undefined;
		return { requests, summarizerCalls, entries, compactions, lastStopReason };
	} finally {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
}

const call =
	(name: string, args: Parameters<typeof fauxToolCall>[1]): Step =>
	() =>
		fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

test("mid-run threshold compaction restores the skill in the very next request", async () => {
	const result = await runScenario(
		({ skillFile, bigFile }) => [
			call("read", { path: skillFile }),
			call("read", { path: bigFile }),
		],
		(session) => session.prompt("Write the files."),
	);

	expect(result.summarizerCalls).toBeGreaterThan(0);
	expect(result.entries.indexOf("compaction")).toBeLessThan(result.entries.lastIndexOf("message"));
	expect(result.requests).toHaveLength(3);
	expect(result.requests[1]).not.toContain(SKILL_CARRYOVER_PREAMBLE);
	expect(result.requests[2]).toContain(SKILL_CARRYOVER_PREAMBLE);
	expect(result.requests[2]).toContain(RULE);
});

test("overflow recovery restores the skill in the retried request", async () => {
	const result = await runScenario(
		({ skillFile, bigFile }) => [
			call("read", { path: skillFile }),
			call("read", { path: bigFile }),
			() =>
				fauxAssistantMessage("", {
					stopReason: "error",
					errorMessage: "prompt is too long: 210000 tokens > 200000 maximum",
				}),
		],
		(session) => session.prompt("Write the files."),
		{ reserveTokens: 20_000 },
	);

	expect(result.compactions).toEqual([{ reason: "overflow", willRetry: true }]);
	expect(result.requests).toHaveLength(4);
	expect(result.requests[2]).not.toContain(SKILL_CARRYOVER_PREAMBLE);
	expect(result.requests[3]).toContain(SKILL_CARRYOVER_PREAMBLE);
	expect(result.requests[3]).toContain(RULE);
	expect(result.lastStopReason).toBe("stop");
});

test("manual compaction restores the skill on the next prompt without writing a session entry", async () => {
	const result = await runScenario(
		({ skillFile }) => [call("read", { path: skillFile })],
		async (session) => {
			await session.prompt("Load the ledger skill.");
			await session.compact();
			await session.prompt("Next task.");
		},
	);

	expect(result.requests.at(-1)).toContain(SKILL_CARRYOVER_PREAMBLE);
	expect(result.requests.at(-1)).toContain(RULE);
	expect(result.entries).not.toContain("custom_message");
});

function paginatedScenario(tail: { offset?: number; limit?: number }[]) {
	let keptTail: string[] = [];
	return runScenario(
		({ skillFile }) => [
			call("read", { path: skillFile, limit: 3 }),
			call("read", { path: skillFile, offset: 4 }),
			() => fauxAssistantMessage("loaded"),
			...tail.map((window) => call("read", { path: skillFile, ...window })),
		],
		async (session) => {
			await session.prompt("Load the ledger skill page by page.");
			await session.prompt(`Check the skill again.\n\n${"context ".repeat(500)}`);
			await session.compact();
			const branch = session.sessionManager.getBranch();
			const compaction = branch.findLast((entry) => entry.type === "compaction");
			const first = branch.findIndex(
				(entry) => compaction?.type === "compaction" && entry.id === compaction.firstKeptEntryId,
			);
			keptTail = branch.slice(first).map((entry) => JSON.stringify(entry));
			await session.prompt("Next task.");
		},
		{ keepRecentTokens: 500 },
	).then((result) => ({ ...result, keptTail }));
}

test("pi's read tool paginating the skill before the cut and excerpting it after still restores it", async () => {
	const result = await paginatedScenario([{ limit: 1 }]);

	expect(result.keptTail.some((entry) => entry.includes('"limit":1'))).toBe(true);
	expect(result.keptTail.some((entry) => entry.includes(RULE))).toBe(false);
	expect(result.requests.at(-1)).toContain(SKILL_CARRYOVER_PREAMBLE);
	expect(result.requests.at(-1)).toContain(RULE);
});

test("pi's read tool paging through the whole skill in the kept tail adds no carry-over", async () => {
	const result = await paginatedScenario([{ offset: 4 }, { limit: 3 }]);

	expect(result.keptTail.some((entry) => entry.includes(RULE))).toBe(true);
	expect(result.keptTail.some((entry) => entry.includes('"limit":3'))).toBe(true);
	expect(result.requests.at(-1)).not.toContain(SKILL_CARRYOVER_PREAMBLE);
});

test("a virtual selection gets no carry-over, while the physical model it routes to does", async () => {
	const scenario = (model: NonNullable<ScenarioOptions["model"]>) =>
		runScenario(
			({ skillFile }) => [call("read", { path: skillFile })],
			async (session) => {
				await session.prompt("Load the ledger skill.");
				await session.compact();
				await session.prompt("Next task.");
			},
			{ reserveTokens: 4_000, model },
		);
	const [routed, direct] = await Promise.all([scenario("virtual"), scenario("small")]);

	expect(routed.requests.at(-1)).not.toContain(SKILL_CARRYOVER_PREAMBLE);
	expect(routed.lastStopReason).toBe("stop");
	expect(direct.requests.at(-1)).toContain(SKILL_CARRYOVER_PREAMBLE);
	expect(direct.requests.at(-1)).toContain(RULE);
});
