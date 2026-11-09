import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	formatSkillsForPrompt,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import {
	budgetedSkillsSection,
	catalogBudgetChars,
	hintedSkills,
	rankSkills,
	SKILL_HINT_CUSTOM_TYPE,
	SKILL_SEARCH_TOOL,
	searchSkills,
	skillCatalog,
	suggestSkills,
} from "./skillCatalog";

const skill = (
	name: string,
	description: string,
	source = "local",
	scope: "user" | "project" | "temporary" = "user",
): Skill =>
	({
		name,
		description,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		sourceInfo: { path: `/skills/${name}/SKILL.md`, source, scope, origin: "top-level" },
		disableModelInvocation: false,
	}) as Skill;

const many = (count: number, source: string) =>
	Array.from({ length: count }, (_, i) =>
		skill(
			`${source}-skill-${i}`,
			`Helps with ${source} chore number ${i}. ${"Detail ".repeat(40)}`,
			source,
		),
	);

test("the catalog budget is 2% of a known window between 4K and 8K tokens, never over 10% of it", () => {
	const model = (contextWindow: number, api = "anthropic-messages") =>
		({ contextWindow, api }) as Parameters<typeof catalogBudgetChars>[0];
	expect(catalogBudgetChars(model(100_000))).toBe(4_000 * 4);
	expect(catalogBudgetChars(model(300_000))).toBe(6_000 * 4);
	expect(catalogBudgetChars(model(1_000_000))).toBe(8_000 * 4);
	expect(catalogBudgetChars(model(16_000))).toBe(1_600 * 4);
	expect(catalogBudgetChars(model(0))).toBe(4_000 * 4);
	expect(catalogBudgetChars(model(1_000_000, "pi-virtual"))).toBe(4_000 * 4);
	expect(catalogBudgetChars(undefined)).toBe(4_000 * 4);
});

test("a catalog that fits keeps pi's own section", () => {
	const skills = [skill("pdf", "Fill PDF forms."), skill("git", "Write commit messages.")];
	expect(budgetedSkillsSection(skills, 10_000)).toBeUndefined();
});

test("an oversized catalog stays within budget and names what it left out", () => {
	const skills = [...many(30, "local"), ...many(800, "gemini"), ...many(200, "claude")];
	const full = formatSkillsForPrompt(skills).length;
	const budget = 16_000;
	const section = budgetedSkillsSection(skills, budget)?.text;
	expect(full).toBeGreaterThan(budget * 10);
	expect(section).toBeDefined();
	expect(section?.length).toBeLessThanOrEqual(budget);
	expect(section).toContain(SKILL_SEARCH_TOOL);
	expect(section).toMatch(/Only \d+ of 1030 skills are listed here/);
	expect(section).toMatch(/Unlisted skills by source: gemini \d+, claude 200\.$/);
	expect(section).toContain("<name>local-skill-0</name>");
	expect(section).not.toContain("<name>gemini-skill-799</name>");
	expect(section).not.toContain("<name>claude-skill-0</name>");
});

test("descriptions are shortened in the budgeted section", () => {
	const skills = many(400, "local");
	const section = budgetedSkillsSection(skills, 16_000)?.text ?? "";
	const description = section.match(/<description>(.*?)<\/description>/)?.[1] ?? "";
	expect(description.length).toBeLessThanOrEqual(240);
	expect(description.endsWith("…")).toBe(true);
});

test("project skills rank first, then ThinkRail's, then pi's, then other agents', keeping order within a tier", () => {
	const ranked = rankSkills([
		skill("claude-a", "x", "claude"),
		skill("native-a", "x"),
		skill("bundled-a", "x", "local", "temporary"),
		skill("project-a", "x", "local", "project"),
		skill("gemini-a", "x", "gemini"),
		skill("native-b", "x"),
		{ ...skill("hidden", "x"), disableModelInvocation: true },
	]);
	expect(ranked.map((s) => s.name)).toEqual([
		"project-a",
		"bundled-a",
		"native-a",
		"native-b",
		"claude-a",
		"gemini-a",
	]);
});

test("search ranks by name and description terms and honours the limit", () => {
	const skills = [
		skill("pdf-forms", "Fill and flatten PDF forms."),
		skill("docx", "Edit Word documents, including tables."),
		skill("pdf-extract", "Extract text and tables from a PDF.", "gemini"),
		skill("video", "Render a promo video."),
		{ ...skill("pdf-secret", "PDF things."), disableModelInvocation: true },
	];
	const names = (query: string, limit?: number) =>
		searchSkills(skills, query, limit).map((match) => match.skill.name);
	expect(names("pdf tables")).toEqual(["pdf-extract", "pdf-forms", "docx"]);
	expect(names("PDF", 1)).toHaveLength(1);
	expect(names("PDF", Number.NaN)).toHaveLength(2);
	expect(names("docx")[0]).toBe("docx");
	expect(names("кириллица")).toEqual([]);
	expect(names("   ")).toEqual([]);
});

test("a hint names only unlisted skills the prompt matches distinctively, once each", () => {
	const chores = many(200, "local");
	const quokka = skill(
		"quokka-invoices",
		"Use when reconciling quokka invoices against the payment log.",
	);
	const listedPdf = skill("pdf-forms", "Fill PDF forms.");
	const skills = [listedPdf, ...chores, quokka];
	const unlisted = [...chores.slice(50), quokka];
	const names = (prompt: string, exclude?: ReadonlySet<string>) =>
		suggestSkills(skills, unlisted, prompt, exclude).map((s) => s.name);
	expect(names("Reconcile the quokka invoices in invoices.txt")).toEqual(["quokka-invoices"]);
	expect(names("Reconcile the quokka invoices", new Set(["quokka-invoices"]))).toEqual([]);
	expect(names("Fill the PDF forms")).toEqual([]);
	expect(names("Fix the failing test and help with the chore")).toEqual([]);
	expect(suggestSkills(skills, [], "quokka invoices")).toEqual([]);
});

async function catalogFixture() {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-skill-catalog-"));
	const agentDir = join(cwd, ".pi-agent");
	const hostSkills = join(cwd, "host-skills");
	const write = (root: string, name: string, description: string) => {
		const dir = join(root, name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`,
		);
	};
	for (let i = 0; i < 300; i++)
		write(hostSkills, `chore-${i}`, `Handles routine chore ${i}. ${"Filler ".repeat(30)}`);
	write(join(agentDir, "skills"), "aa-invoice-ledger", "Reconcile invoices against the ledger.");
	write(join(agentDir, "skills"), "aa-quokka-payments", "Settle quokka payments with the bank.");
	const faux = createFauxCore({
		provider: "catalog-probe",
		api: "catalog-probe",
		models: [
			{
				id: "catalog-probe",
				name: "Catalog probe",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 100,
			},
		],
		tokensPerSecond: 1_000_000,
	});
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("catalog-probe", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: faux.models.map((m) => ({ ...m, api: faux.api })),
	});
	const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		additionalSkillPaths: [hostSkills],
		extensionFactories: [skillCatalog],
	});
	await resourceLoader.reload();
	const createSession = (tools?: string[]) =>
		createAgentSession({
			cwd,
			agentDir,
			model: faux.getModel(),
			modelRuntime: runtime,
			settingsManager,
			resourceLoader,
			sessionManager: SessionManager.inMemory(cwd),
			...(tools ? { tools } : {}),
		});
	return { cwd, agentDir, faux, createSession };
}

test("a pi session with an oversized catalog gets the budgeted section and finds unlisted skills", async () => {
	const { cwd, agentDir, faux, createSession } = await catalogFixture();
	const results: string[] = [];
	const skillSections: string[] = [];
	const hints: string[] = [];
	const lastHint = (messages: unknown) =>
		[...JSON.stringify(messages).matchAll(/Skills not listed[^"]*/g)].at(-1)?.[0];
	faux.setResponses([
		(context) => {
			const hint = lastHint(context.messages);
			if (hint) hints.push(hint);
			const system = context.messages.find((message) => message.role === "system");
			skillSections.push(system?.role === "system" ? (system.sections?.skills ?? "") : "");
			return fauxAssistantMessage(fauxToolCall(SKILL_SEARCH_TOOL, { query: "invoice ledger" }), {
				stopReason: "toolUse",
			});
		},
		(context) => {
			const last = context.messages.at(-1);
			if (last?.role === "toolResult")
				for (const part of last.content) if (part.type === "text") results.push(part.text);
			return fauxAssistantMessage("done");
		},
		() => fauxAssistantMessage("again"),
		(context) => {
			const hint = lastHint(context.messages);
			if (hint) hints.push(hint);
			return fauxAssistantMessage("settled");
		},
		() => fauxAssistantMessage("reloaded"),
	]);
	const { session } = await createSession();
	try {
		await session.prompt("Reconcile this month's invoices.");
		const section = skillSections[0] ?? "";
		expect(section).toContain(`call ${SKILL_SEARCH_TOOL}`);
		expect(section).toMatch(/<name>chore-\d+<\/name>/);
		expect(section).not.toContain("<name>aa-invoice-ledger</name>");
		expect(section).not.toContain("<name>aa-quokka-payments</name>");
		expect(section.length).toBeLessThan(catalogBudgetChars(faux.getModel()) + 40);
		expect(results.join("\n")).toContain(
			"- aa-invoice-ledger: Reconcile invoices against the ledger.",
		);
		expect(results.join("\n")).toContain(join(agentDir, "skills", "aa-invoice-ledger", "SKILL.md"));
		expect(hints).toHaveLength(1);
		expect(hints[0]).toContain("- aa-invoice-ledger: Reconcile invoices against the ledger.");
		const entries = session.sessionManager.getBranch();
		const hintEntries = (branch: typeof entries) =>
			branch.filter((e) => e.type === "custom_message" && e.customType === SKILL_HINT_CUSTOM_TYPE);
		expect(hintEntries(entries)).toHaveLength(1);
		await session.prompt("Reconcile the invoices against the ledger again.");
		expect(hintEntries(session.sessionManager.getBranch())).toHaveLength(1);
		await session.prompt("Settle the quokka payments.");
		expect(hintEntries(session.sessionManager.getBranch())).toHaveLength(2);
		expect(hints.at(-1)).toContain("- aa-quokka-payments: Settle quokka payments with the bank.");
		await session.reload();
		await session.prompt("Settle the quokka payments once more.");
		expect(hintEntries(session.sessionManager.getBranch())).toHaveLength(2);
	} finally {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("a /skill: invocation never hints at itself and matches only the request typed after it", async () => {
	const { cwd, faux, createSession } = await catalogFixture();
	faux.setResponses([() => fauxAssistantMessage("one"), () => fauxAssistantMessage("two")]);
	const { session } = await createSession();
	const hinted = () => [...hintedSkills(session.sessionManager.getBranch())].sort();
	try {
		await session.prompt("/skill:aa-quokka-payments Do it today.");
		expect(hinted()).toEqual([]);
		await session.prompt("/skill:aa-quokka-payments Reconcile the invoices against the ledger.");
		expect(hinted()).toEqual(["aa-invoice-ledger"]);
	} finally {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("a session that cannot call skill_search keeps pi's full skill listing", async () => {
	const { cwd, faux, createSession } = await catalogFixture();
	const skillSections: string[] = [];
	faux.setResponses([
		(context) => {
			const system = context.messages.find((message) => message.role === "system");
			skillSections.push(system?.role === "system" ? (system.sections?.skills ?? "") : "");
			return fauxAssistantMessage("done");
		},
	]);
	const { session } = await createSession(["read"]);
	try {
		await session.prompt("Reconcile this month's invoices.");
		const section = skillSections[0] ?? "";
		expect(section).not.toContain(SKILL_SEARCH_TOOL);
		expect(section).toContain("<name>aa-invoice-ledger</name>");
	} finally {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});
