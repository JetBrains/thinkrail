import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	type FauxResponseStep,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSessionEvent,
	createAgentSession,
	DEFAULT_MAX_BYTES,
	DefaultResourceLoader,
	estimateTokens,
	findCutPoint,
	generateSummary,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

async function scenario(responses: FauxResponseStep[], overflow = false) {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-context-probe-"));
	const agentDir = join(cwd, ".pi-agent");
	mkdirSync(agentDir);
	const source = `---\nid: sample\ntype: module-design\n---\n${`needle ${"x".repeat(1000)}\n`.repeat(240)}`;
	writeFileSync(join(cwd, "SPEC.md"), source);
	const model = {
		id: "context-probe",
		name: "Context probe",
		reasoning: false,
		input: ["text"] as "text"[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: overflow ? 1000 : 1_000_000,
		maxTokens: 100,
	};
	const faux = createFauxCore({
		provider: "context-probe",
		api: "context-probe",
		models: [model],
		tokensPerSecond: 100_000,
	});
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("context-probe", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	const settingsManager = SettingsManager.inMemory(
		overflow ? { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } } : {},
	);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		additionalExtensionPaths: [require.resolve("pi-spec-graph/index.ts")],
		extensionFactories: [
			(pi) => {
				pi.registerTool({
					name: "unbounded_fixture",
					label: "Fixture",
					description: "Synthetic unbounded output",
					parameters: Type.Object({}),
					async execute() {
						return {
							content: [{ type: "text", text: source }],
							details: { marker: "PRESENTATION_ONLY", source },
						};
					},
				});
				if (overflow)
					pi.on("session_before_compact", (event) => ({
						compaction: {
							summary: "Synthetic bounded summary.",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
						},
					}));
			},
		],
	});
	await resourceLoader.reload();
	const requests: { toolTextBytes: number[]; toolErrors: boolean[]; content: string }[] = [];
	faux.setResponses(
		responses.map((response) => (context, options, state, activeModel) => {
			requests.push({
				toolTextBytes: context.messages
					.filter((message) => message.role === "toolResult")
					.map((message) =>
						Buffer.byteLength(
							message.content
								.filter((block) => block.type === "text")
								.map((block) => block.text)
								.join("\n"),
						),
					),
				toolErrors: context.messages
					.filter((message) => message.role === "toolResult")
					.map((message) => message.isError),
				content: JSON.stringify(context.messages.map((message) => message.content)),
			});
			return typeof response === "function"
				? response(context, options, state, activeModel)
				: response;
		}),
	);
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
		await session.prompt(overflow ? "x".repeat(5000) : "Run the synthetic fixture.");
		return { events, requests, callCount: faux.state.callCount };
	} finally {
		unsubscribe();
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("Pi receives bounded native and spec-search results, but does not bound arbitrary extension output", async () => {
	for (const name of ["read", "spec_grep", "unbounded_fixture"]) {
		const args =
			name === "read" ? { path: "SPEC.md" } : name === "spec_grep" ? { pattern: "needle" } : {};
		const result = await scenario([
			fauxAssistantMessage(fauxToolCall(name, args)),
			fauxAssistantMessage("Done"),
		]);
		expect(result.callCount).toBe(2);
		const request = result.requests[1];
		expect(request?.toolTextBytes).toHaveLength(1);
		expect(request?.toolErrors).toEqual([false]);
		expect(request?.content).toContain("needle");
		const bytes = request?.toolTextBytes[0] ?? 0;
		if (name === "unbounded_fixture") expect(bytes).toBeGreaterThan(DEFAULT_MAX_BYTES);
		else expect(bytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(request?.content).not.toContain("PRESENTATION_ONLY");
		expect(result.events.at(-1)?.type).toBe("agent_settled");
	}
});

test("Pi parity: a retained tool pair can exceed the recent-token target", () => {
	const session = SessionManager.inMemory("/synthetic-context-probe");
	session.appendMessage({ role: "user", content: "Earlier context", timestamp: 1 });
	session.appendMessage(fauxAssistantMessage("Earlier answer"));
	session.appendMessage({ role: "user", content: "Current task", timestamp: 2 });
	session.appendMessage(
		fauxAssistantMessage(
			fauxToolCall("fixture", { text: "x".repeat(20000) }, { id: "large-call" }),
		),
	);
	session.appendMessage({
		role: "toolResult",
		toolCallId: "large-call",
		toolName: "fixture",
		content: [{ type: "text", text: "x".repeat(60000) }],
		isError: false,
		timestamp: 3,
	});
	const entries = session.getBranch();
	const cut = findCutPoint(entries, 0, entries.length, 2000);
	const retained = entries
		.slice(cut.firstKeptEntryIndex)
		.flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
	expect(retained.map((message) => message.role)).toEqual(["assistant", "toolResult"]);
	expect(retained.reduce((total, message) => total + estimateTokens(message), 0)).toBeGreaterThan(
		8000,
	);
});

test("Pi parity: summary output limits do not bound aggregate summary input", async () => {
	const faux = createFauxCore({
		provider: "summary-input-probe",
		models: [{ id: "summary-input", contextWindow: 8000, maxTokens: 1024 }],
		tokensPerSecond: 100_000,
	});
	const requestBytes: number[] = [];
	faux.setResponses([
		(context) => {
			requestBytes.push(
				Buffer.byteLength(JSON.stringify(context.messages.map((message) => message.content))),
			);
			return fauxAssistantMessage("Synthetic summary");
		},
	]);
	await generateSummary(
		[{ role: "user", content: "x".repeat(100000), timestamp: 1 }],
		faux.getModel(),
		512,
		"faux",
		undefined,
		undefined,
		undefined,
		undefined,
		"off",
		faux.streamSimple,
	);
	expect(faux.state.callCount).toBe(1);
	expect(requestBytes).toHaveLength(1);
	expect(requestBytes[0]).toBeGreaterThan(8000 * 4);
});

function overflowError(timestamp = Date.now()) {
	return fauxAssistantMessage("", {
		stopReason: "error",
		errorMessage: "400 invalid_request_error: prompt is too long: 12000 tokens > 1000 maximum",
		timestamp,
	});
}

test("Pi retries a provider context overflow once before a final settlement", async () => {
	const result = await scenario([overflowError(), fauxAssistantMessage("Recovered")], true);
	expect(result.callCount).toBe(2);
	expect(
		result.events
			.filter((event) => event.type === "compaction_end")
			.map((event) => event.willRetry),
	).toEqual([true]);
	expect(result.events.filter((event) => event.type === "agent_settled")).toHaveLength(1);
	expect(result.events.at(-1)?.type).toBe("agent_settled");
});

test("Pi reports exhausted context recovery instead of retrying indefinitely", async () => {
	const result = await scenario([overflowError(), () => overflowError(Date.now() + 60_000)], true);
	expect(result.callCount).toBe(2);
	const ends = result.events.filter((event) => event.type === "compaction_end");
	expect(ends.map((event) => event.willRetry)).toEqual([true, false]);
	expect(ends[1]?.errorMessage).toContain(
		"Context overflow recovery failed after one compact-and-retry attempt",
	);
	expect(result.events.filter((event) => event.type === "agent_settled")).toHaveLength(1);
	expect(result.events.at(-1)?.type).toBe("agent_settled");
});
