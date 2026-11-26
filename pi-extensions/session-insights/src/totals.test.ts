import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
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
	ModelRuntime,
	parseSessionEntries,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { tempDir } from "../test/builders.ts";
import { SessionIndex } from "./sessionIndex.ts";
import { summarizeSessionText } from "./summary.ts";
import { recordedTotals } from "./totals.ts";

const PROVIDER = "faux-insights";
const MODEL = "faux-insights-model";
const model = {
	id: MODEL,
	name: MODEL,
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 4096,
};
const faux = createFauxCore({ provider: PROVIDER, api: PROVIDER, models: [model] });
const root = tempDir("totals");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const spend = (seed: number, total: number) => ({
	input: seed,
	output: seed + 1,
	cacheRead: seed + 2,
	cacheWrite: seed + 3,
	totalTokens: 4 * seed + 6,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
});

function transcriptWithEverySpendSource(): string {
	const transcript = SessionManager.create(join(root, "cwd"), join(root, "sessions"));
	transcript.appendMessage({ role: "user", content: "Find it.", timestamp: Date.now() });
	const askedId = transcript.appendMessage({
		...fauxAssistantMessage([fauxToolCall("search", { q: "it" }, { id: "call-1" })], {
			stopReason: "toolUse",
		}),
		usage: spend(10, 0.011),
	});
	transcript.appendMessage({
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "search",
		content: [{ type: "text", text: "found" }],
		isError: false,
		usage: spend(20, 0.022),
		timestamp: Date.now(),
	});
	transcript.appendCompaction("Compacted.", askedId, 1_000, undefined, false, spend(30, 0.033));
	transcript.branchWithSummary(askedId, "Abandoned branch.", undefined, false, spend(40, 0.044));
	transcript.appendUsage("cache_warm", "faux", "faux", spend(50, 0.055));
	transcript.appendUsage("subagent", "faux", "faux", spend(60, 0), "child-1");
	const file = transcript.getSessionFile();
	if (!file) throw new Error("expected a persisted transcript");
	return file;
}

async function piStats(file: string) {
	const agentDir = join(root, "agent");
	const modelRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	modelRuntime.registerProvider(PROVIDER, {
		api: faux.api,
		baseUrl: "http://faux-insights.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		settingsManager,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const fauxModel = modelRuntime.getModel(PROVIDER, MODEL);
	if (!fauxModel) throw new Error("the faux model is not registered");
	const { session } = await createAgentSession({
		cwd: root,
		agentDir,
		modelRuntime,
		model: fauxModel,
		sessionManager: SessionManager.open(file),
		settingsManager,
		resourceLoader,
	});
	try {
		return session.getSessionStats();
	} finally {
		session.dispose();
	}
}

test("the recorded totals mirror matches pi's getSessionStats for every spend source, off-branch included", async () => {
	const file = transcriptWithEverySpendSource();
	const text = readFileSync(file, "utf8");
	const pi = await piStats(file);
	expect(pi.tokens).toMatchObject({ input: 210, output: 216, cacheRead: 222, cacheWrite: 228 });
	expect(pi.cost).toBeCloseTo(0.165, 12);

	const index = new SessionIndex({
		sessionFiles: async () => [file],
		childTranscriptDirs: async () => [],
	});
	await index.ensureFresh(10_000);
	const mirrors = [
		recordedTotals(parseSessionEntries(text)),
		summarizeSessionText(file, text)?.spend,
		index.summaries()[0]?.spend,
	];
	for (const mirror of mirrors) {
		expect(mirror).toMatchObject({
			input: pi.tokens.input,
			output: pi.tokens.output,
			cacheRead: pi.tokens.cacheRead,
			cacheWrite: pi.tokens.cacheWrite,
		});
		expect(mirror?.cost).toBeCloseTo(pi.cost, 12);
		expect(mirror?.unpricedTokens).toBe(4 * 60 + 6);
	}
	const counts = summarizeSessionText(file, text)?.counts;
	expect(counts).toMatchObject({
		userMessages: pi.userMessages,
		assistantMessages: pi.assistantMessages,
		toolCalls: pi.toolCalls,
		toolResults: pi.toolResults,
	});
});
