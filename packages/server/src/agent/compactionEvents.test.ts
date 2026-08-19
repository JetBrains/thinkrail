import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { isTranscriptMessageRole } from "@thinkrail/contracts";

// Pins the compaction event contract the chat's visible lifecycle is built on: the web reducer's unit
// tests replay these shapes, and this file pins that a real Pi session actually emits them.

const MODEL = {
	id: "compaction-probe",
	name: "Compaction visibility probe",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	// The ~1250-token prompt crosses the threshold line (window − reserve = 1000) while staying far
	// below the window itself — a real threshold compaction, not a silent-overflow one.
	contextWindow: 200_000,
	maxTokens: 100,
};

interface ScenarioOptions {
	/** Register a `session_before_compact` extension supplying the summary (no summarization LLM call). */
	extensionCompaction: boolean;
	responses: Parameters<ReturnType<typeof createFauxCore>["setResponses"]>[0];
}

async function runCompactionScenario({ extensionCompaction, responses }: ScenarioOptions): Promise<{
	events: AgentSessionEvent[];
	callCount: number;
	messages: { role: string }[];
}> {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-compaction-events-"));
	const agentDir = join(cwd, ".pi-agent");
	mkdirSync(agentDir);
	const faux = createFauxCore({
		provider: "compaction-probe",
		api: "compaction-probe",
		models: [MODEL],
		tokensPerSecond: 100_000,
	});
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("compaction-probe", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...MODEL, api: faux.api }],
	});
	// Retry disabled so a scripted summarization failure fails once instead of backing off.
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 199_000 },
		retry: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: extensionCompaction
			? [
					(pi) => {
						pi.on("session_before_compact", (event) => ({
							compaction: {
								summary: "Earlier work summarized.",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
							},
						}));
					},
				]
			: [],
	});
	await resourceLoader.reload();
	faux.setResponses(responses);
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: faux.getModel(),
		modelRuntime: runtime,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
	});
	const events: AgentSessionEvent[] = [];
	const unsubscribe = session.subscribe((event) => events.push(event));
	try {
		await session.prompt("x".repeat(5000));
		return {
			events,
			callCount: faux.state.callCount,
			messages: session.messages.map((message) => ({ role: message.role })),
		};
	} finally {
		unsubscribe();
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("threshold compaction after a completed response: visible lifecycle, no unsolicited continuation", async () => {
	const result = await runCompactionScenario({
		extensionCompaction: true,
		responses: [fauxAssistantMessage("all done")],
	});

	// One LLM call, one agent run — a threshold compaction never continues by itself.
	expect(result.callCount).toBe(1);
	expect(result.events.filter((event) => event.type === "agent_start")).toHaveLength(1);

	const types = result.events.map((event) => event.type);
	const starts = result.events.filter((event) => event.type === "compaction_start");
	const ends = result.events.filter((event) => event.type === "compaction_end");
	expect(starts.map((event) => event.reason)).toEqual(["threshold"]);
	expect(ends).toHaveLength(1);
	const end = ends[0];
	expect(end?.reason).toBe("threshold");
	expect(end?.aborted).toBe(false);
	expect(end?.willRetry).toBe(false);
	expect(end?.errorMessage).toBeUndefined();
	expect(typeof end?.result?.tokensBefore).toBe("number");
	expect(typeof end?.result?.estimatedTokensAfter).toBe("number");
	expect(types.indexOf("agent_end")).toBeLessThan(types.indexOf("compaction_start"));
	expect(types.indexOf("compaction_start")).toBeLessThan(types.indexOf("compaction_end"));
	expect(types.at(-1)).toBe("agent_settled");

	// The durable record reload/reopen re-renders the notice from.
	expect(result.messages.some((message) => message.role === "compactionSummary")).toBe(true);
	expect(isTranscriptMessageRole("compactionSummary")).toBe(true);
});

test("a failed compaction emits a visible error end and does not loop", async () => {
	const result = await runCompactionScenario({
		extensionCompaction: false,
		responses: [
			fauxAssistantMessage("all done"),
			// The summarization LLM call itself — scripted to fail once.
			() => {
				throw new Error("compaction summarizer down");
			},
		],
	});

	expect(result.callCount).toBe(2); // one turn + one failed summarization — no retry loop

	expect(result.events.filter((event) => event.type === "agent_start")).toHaveLength(1);
	const ends = result.events.filter((event) => event.type === "compaction_end");
	expect(ends).toHaveLength(1);
	const end = ends[0];
	expect(end?.aborted).toBe(false);
	expect(end?.willRetry).toBe(false);
	expect(end?.result).toBeUndefined();
	expect(end?.errorMessage).toContain("compaction summarizer down");
	expect(result.events.at(-1)?.type).toBe("agent_settled");

	// A failed compaction leaves no durable record.
	expect(result.messages.some((message) => message.role === "compactionSummary")).toBe(false);
});
