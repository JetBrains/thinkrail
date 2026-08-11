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

const MODEL = {
	id: "length-probe",
	name: "Length recovery probe",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

async function runLengthScenario(
	responses: Parameters<ReturnType<typeof createFauxCore>["setResponses"]>[0],
): Promise<{ events: AgentSessionEvent[]; callCount: number; finalText: string | undefined }> {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-pi-length-"));
	const agentDir = join(cwd, ".pi-agent");
	mkdirSync(agentDir);
	const faux = createFauxCore({
		provider: "length-probe",
		api: "length-probe",
		models: [MODEL],
		tokensPerSecond: 100_000,
	});
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("length-probe", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...MODEL, api: faux.api }],
	});
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: [
			(pi) => {
				pi.on("session_before_compact", (event) => ({
					compaction: {
						summary: "Compacted after a premature length stop.",
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
					},
				}));
			},
		],
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
		const finalAssistant = [...session.messages]
			.reverse()
			.find((message) => message.role === "assistant");
		const firstBlock = finalAssistant?.content[0];
		return {
			events,
			callCount: faux.state.callCount,
			finalText: firstBlock?.type === "text" ? firstBlock.text : undefined,
		};
	} finally {
		unsubscribe();
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("Pi compacts and retries a premature length stop before settling", async () => {
	const result = await runLengthScenario([
		fauxAssistantMessage("incomplete", { stopReason: "length" }),
		fauxAssistantMessage("completed response"),
	]);

	expect(result.callCount).toBe(2);
	expect(result.finalText).toBe("completed response");
	expect(result.events.filter((event) => event.type === "agent_start")).toHaveLength(2);
	expect(
		result.events
			.filter((event) => event.type === "compaction_end")
			.map((event) => ({ reason: event.reason, willRetry: event.willRetry })),
	).toEqual([{ reason: "overflow", willRetry: true }]);
	expect(result.events.at(-1)?.type).toBe("agent_settled");
});

test("Pi stops after one compact-and-retry attempt when length recurs", async () => {
	const result = await runLengthScenario([
		fauxAssistantMessage("first incomplete", { stopReason: "length" }),
		() =>
			fauxAssistantMessage("second incomplete", {
				stopReason: "length",
				timestamp: Date.now() + 60_000,
			}),
	]);

	expect(result.callCount).toBe(2);
	const compactionEnds = result.events.filter((event) => event.type === "compaction_end");
	expect(compactionEnds).toHaveLength(2);
	expect(compactionEnds[0]?.willRetry).toBe(true);
	expect(compactionEnds[1]?.willRetry).toBe(false);
	expect(compactionEnds[1]?.errorMessage).toContain("failed after one compact-and-retry attempt");
	expect(result.events.at(-1)?.type).toBe("agent_settled");
});
