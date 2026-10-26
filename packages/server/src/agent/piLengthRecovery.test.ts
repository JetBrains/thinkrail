import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
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

async function runRecoveryScenario(
	responses: Parameters<ReturnType<typeof createFauxCore>["setResponses"]>[0],
	seed?: (manager: SessionManager, model: Model<string>) => void,
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
						summary: "Compacted for context recovery.",
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
					},
				}));
			},
		],
	});
	await resourceLoader.reload();
	faux.setResponses(responses);
	const sessionManager = SessionManager.inMemory(cwd);
	seed?.(sessionManager, faux.getModel());
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: faux.getModel(),
		modelRuntime: runtime,
		settingsManager,
		resourceLoader,
		sessionManager,
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

const RECOVERY_STOPS = [
	{
		name: "a premature length stop",
		errorPrefix: "Truncated response",
		response: { stopReason: "length" },
	},
	{
		name: "a provider context overflow",
		errorPrefix: "Context overflow",
		response: {
			stopReason: "error",
			errorMessage: "400 invalid_request_error: prompt is too long: 12000 tokens > 1000 maximum",
		},
	},
] as const;

test.each(RECOVERY_STOPS)("Pi compacts and retries $name before settling", async ({ response }) => {
	const result = await runRecoveryScenario([
		fauxAssistantMessage("incomplete", response),
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
	expect(result.events.filter((event) => event.type === "agent_settled")).toHaveLength(1);
	expect(result.events.at(-1)?.type).toBe("agent_settled");
});

test("pre-prompt recovery omits a restored truncated call together with its result", async () => {
	let requested = false;
	const result = await runRecoveryScenario(
		[
			(context) => {
				requested = true;
				expect(context.messages.some((message) => message.role === "toolResult")).toBe(false);
				expect(
					context.messages.some(
						(message) => message.role === "assistant" && message.stopReason === "length",
					),
				).toBe(false);
				return fauxAssistantMessage("recovered");
			},
		],
		(manager, model) => {
			manager.appendMessage({ role: "user", content: "check status", timestamp: 1 });
			manager.appendMessage({
				...fauxAssistantMessage([fauxToolCall("bash", { command: "echo" }, { id: "truncated" })], {
					stopReason: "length",
					timestamp: 2,
				}),
				api: model.api,
				provider: model.provider,
				model: model.id,
			});
			manager.appendMessage({
				role: "toolResult",
				toolCallId: "truncated",
				toolName: "bash",
				isError: true,
				content: [{ type: "text", text: "Not executed: output token limit reached." }],
				timestamp: 3,
			});
		},
	);
	expect(requested).toBe(true);
	expect(result.finalText).toBe("recovered");
	expect(result.events.at(-1)?.type).toBe("agent_settled");
});

test.each(RECOVERY_STOPS)("Pi stops after one compact-and-retry attempt when $name recurs", async ({
	response,
	errorPrefix,
}) => {
	const result = await runRecoveryScenario([
		fauxAssistantMessage("first incomplete", response),
		() =>
			fauxAssistantMessage("second incomplete", {
				...response,
				timestamp: Date.now() + 60_000,
			}),
	]);

	expect(result.callCount).toBe(2);
	const compactionEnds = result.events.filter((event) => event.type === "compaction_end");
	expect(compactionEnds).toHaveLength(2);
	expect(compactionEnds[0]?.willRetry).toBe(true);
	expect(compactionEnds[1]?.willRetry).toBe(false);
	expect(compactionEnds[1]?.errorMessage).toContain(
		`${errorPrefix} recovery failed after one compact-and-retry attempt`,
	);
	expect(result.events.filter((event) => event.type === "agent_settled")).toHaveLength(1);
	expect(result.events.at(-1)?.type).toBe("agent_settled");
});
