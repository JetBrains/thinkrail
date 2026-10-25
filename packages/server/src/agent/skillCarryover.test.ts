import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
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

const readCall = (id: string, path: string): Message =>
	assistant([{ type: "toolCall", id, name: "read", arguments: { path } }]);

const readResult = (toolCallId: string, text: string, isError = false): Message =>
	({
		role: "toolResult",
		toolCallId,
		toolName: "read",
		content: [{ type: "text", text }],
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

test("a read reaches its skill through pi's @ prefix, ~ expansion and symlinks", () => {
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
		const sm = session();
		sm.appendMessage(readCall("r1", `@${join(root, "real", "ledger", "SKILL.md")}`));
		sm.appendMessage(readResult("r1", "body"));
		sm.appendMessage(readCall("r2", "~/todos/SKILL.md"));
		sm.appendMessage(readResult("r2", "body"));
		const kept = sm.appendMessage(user("next"));
		sm.appendCompaction("summary", kept, 100);

		expect(compactedSkills(sm.getBranch(), [linked, home], "/repo")).toEqual([linked, home]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
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

test("the budget scales with the context window and caps per skill and in total", () => {
	expect(carryoverBudget(1_000_000)).toEqual({ skillChars: 20_000, totalChars: 100_000 });
	expect(carryoverBudget(128_000)).toEqual({ skillChars: 20_000, totalChars: 51_200 });
	expect(carryoverBudget(32_000)).toEqual({ skillChars: 12_800, totalChars: 12_800 });
	expect(carryoverBudget(undefined)).toEqual({ skillChars: 20_000, totalChars: 100_000 });
});

test("the text keeps the newest skills within budget and truncates from the end", () => {
	const bodies = new Map([
		[LEDGER, "a".repeat(30)],
		[TODOS, "b".repeat(30)],
	]);
	const budget = { skillChars: 20, totalChars: 25 };

	expect(skillCarryoverText(SKILLS, budget, (s) => bodies.get(s))).toBe(
		[
			SKILL_CARRYOVER_PREAMBLE,
			`<skill name="ledger" location="/skills/ledger/SKILL.md">\nReferences are relative to /skills/ledger.\n\naaaaa\n\n[Truncated after compaction. Read /skills/ledger/SKILL.md for the full text.]\n</skill>`,
			`<skill name="todos" location="/skills/todos/SKILL.md">\nReferences are relative to /skills/todos.\n\n${"b".repeat(20)}\n\n[Truncated after compaction. Read /skills/todos/SKILL.md for the full text.]\n</skill>`,
		].join("\n\n"),
	);
	expect(skillCarryoverText(SKILLS, budget, () => undefined)).toBe(undefined);
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

const RULE = "Every reply ends with ledger-ok.";

type Step = FauxResponseFactory;
type Context = Parameters<Step>[0];

const isSummarizer = (context: Context) =>
	JSON.stringify(context).includes("You are a context summarization assistant");

async function runScenario(
	steps: (files: { skillFile: string; bigFile: string }) => Step[],
	drive: (session: AgentSession) => Promise<void>,
): Promise<{ requests: string[]; summarizerCalls: number; entries: string[] }> {
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
		models: [MODEL],
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
		models: [{ ...MODEL, api: faux.api }],
	});
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 190_000 },
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
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: faux.getModel(),
		modelRuntime: runtime,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
	});
	try {
		await drive(session);
		const entries = session.sessionManager.getBranch().map((entry) => entry.type);
		return { requests, summarizerCalls, entries };
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
	);

	expect(result.summarizerCalls).toBeGreaterThan(0);
	expect(result.requests.at(-1)).toContain(SKILL_CARRYOVER_PREAMBLE);
	expect(result.requests.at(-1)).toContain(RULE);
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
