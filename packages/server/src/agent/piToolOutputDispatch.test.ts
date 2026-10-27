import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

async function scenario(responses: FauxResponseStep[]) {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-tool-output-"));
	const agentDir = join(cwd, ".pi-agent");
	mkdirSync(agentDir);
	const source = `---\nid: sample\ntype: module-design\n---\n${`needle ${"x".repeat(1000)}\n`.repeat(240)}`;
	writeFileSync(join(cwd, "SPEC.md"), source);
	const model = {
		id: "tool-output-probe",
		name: "Tool output probe",
		reasoning: false,
		input: ["text"] as "text"[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 100,
	};
	const faux = createFauxCore({
		provider: "tool-output-probe",
		api: "tool-output-probe",
		models: [model],
		tokensPerSecond: 100_000,
		tokenSize: { min: 1024, max: 1024 },
	});
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("tool-output-probe", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		additionalExtensionPaths: [require.resolve("pi-spec-graph/index.ts")],
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
		await session.prompt("Run the tool.");
		return { events, requests, callCount: faux.state.callCount };
	} finally {
		unsubscribe();
		session.dispose();
		for (const event of events) {
			if (event.type !== "tool_execution_end") continue;
			const details = event.result.details as { output?: { fullOutputPath?: string } } | undefined;
			if (details?.output?.fullOutputPath)
				rmSync(dirname(details.output.fullOutputPath), { recursive: true, force: true });
		}
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("Pi receives bounded native and spec-search results", async () => {
	for (const [name, args] of [
		["read", { path: "SPEC.md" }],
		["spec_grep", { pattern: "needle" }],
	] as const) {
		const result = await scenario([
			fauxAssistantMessage(fauxToolCall(name, args)),
			fauxAssistantMessage("Done"),
		]);
		expect(result.callCount).toBe(2);
		const request = result.requests[1];
		expect(request?.toolTextBytes).toHaveLength(1);
		expect(request?.toolErrors).toEqual([false]);
		expect(request?.content).toContain("needle");
		expect(request?.toolTextBytes[0]).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(result.events.at(-1)?.type).toBe("agent_settled");
	}
});

test("Pi dispatches an oversized tool error with its failure flag and bounded error text", async () => {
	const result = await scenario([
		fauxAssistantMessage(fauxToolCall("spec_get", { id: "x".repeat(60000) })),
		fauxAssistantMessage("The lookup failed"),
	]);
	expect(result.callCount).toBe(2);
	expect(result.requests[1]?.toolErrors).toEqual([true]);
	expect(result.requests[1]?.content).toContain("Error:");
	expect(result.requests[1]?.toolTextBytes[0]).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
	expect(result.events.at(-1)?.type).toBe("agent_settled");
});
