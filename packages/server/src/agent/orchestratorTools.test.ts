import { afterEach, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionFactory,
	ExtensionToolContext,
	InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest } from "@thinkrail/contracts";
import { childBaseExtensionFactories } from "./extensions";
import { setOrchestratorHomeResolver } from "./orchestratorPolicy";
import {
	createMergePrTool,
	createMessageChatTool,
	MERGE_APPROVE,
	MERGE_DENY,
	type MergeVerdict,
	ORCHESTRATOR_TOOL_NAMES,
	type OrchestratorToolsHost,
	orchestratorTools,
	setOrchestratorToolsHost,
} from "./orchestratorTools";
import { resolveExtUi, setExtUiPublisher } from "./webUiContext";

afterEach(() => {
	setOrchestratorToolsHost(null);
	setOrchestratorHomeResolver(null);
	setExtUiPublisher(() => {});
});

const ctx = (hasUI = true) =>
	({ sessionManager: { getSessionId: () => "orch-1" }, hasUI }) as unknown as ExtensionToolContext;

function registeredBy(factories: readonly (InlineExtension | ExtensionFactory)[]): string[] {
	const names: string[] = [];
	const pi = {
		registerTool: (tool: { name: string }) => names.push(tool.name),
		on: () => {},
	} as unknown as ExtensionAPI;
	for (const factory of factories)
		void (typeof factory === "function" ? factory : factory.factory)(pi);
	return names;
}

function hostWith(overrides: Partial<OrchestratorToolsHost>): OrchestratorToolsHost {
	const none = async () => "";
	return {
		messageChat: none,
		stopChat: none,
		addWorkspace: none,
		removeWorkspace: none,
		openPr: none,
		mergePr: none,
		...overrides,
	};
}

const textOf = (result: { content: { type: string; text?: string }[] }) =>
	result.content[0]?.type === "text" ? result.content[0].text : "";

test("the container tools register only in an orchestrator's own session, never in a child's", () => {
	setOrchestratorHomeResolver((workspaceId) => (workspaceId === "chat-orch" ? "/home/c1" : null));
	expect(registeredBy([orchestratorTools("w1")])).toEqual([]);
	expect(registeredBy([orchestratorTools("chat-orch")])).toEqual([...ORCHESTRATOR_TOOL_NAMES]);
	expect(registeredBy(childBaseExtensionFactories("chat-orch"))).toEqual([]);
});

test("message_chat hands the caller's session and the message to the host", async () => {
	const calls: unknown[] = [];
	setOrchestratorToolsHost(
		hostWith({
			messageChat: async (caller, params) => {
				calls.push([caller, params]);
				return "Sent.";
			},
		}),
	);
	const params = { workspace: "board", text: "Rebase first", mode: "steer" as const };
	const result = await createMessageChatTool().execute("c-1", params, undefined, undefined, ctx());
	expect(calls).toEqual([["orch-1", params]]);
	expect(textOf(result)).toBe("Sent.");
});

async function mergeWith(
	answer: (request: ExtUiRequest) => void,
	options: { hasUI?: boolean; signal?: AbortSignal; timeoutMs?: number } = {},
) {
	const requests: ExtUiRequest[] = [];
	setExtUiPublisher((request) => {
		requests.push(request);
		answer(request);
	});
	const verdicts: MergeVerdict[] = [];
	const merged: string[] = [];
	setOrchestratorToolsHost(
		hostWith({
			mergePr: async (_caller, params, approve) => {
				const verdict = await approve(
					"Merge PR #7 of ThinkRail · board?\nOnly you can approve this.",
				);
				verdicts.push(verdict);
				if (verdict !== "approved") throw new Error(`Not merged: ${verdict}`);
				merged.push(params.workspace);
				return "Merged PR #7.";
			},
		}),
	);
	const tool = createMergePrTool({ approvalTimeoutMs: options.timeoutMs ?? 5_000 });
	const run = tool.execute(
		"call-merge",
		{ workspace: "board" },
		options.signal,
		undefined,
		ctx(options.hasUI ?? true),
	);
	return { run, requests, verdicts, merged };
}

test("merge_pr asks the human on its own card and merges only on their approval", async () => {
	const approved = await mergeWith((request) =>
		queueMicrotask(() => resolveExtUi({ id: request.id, value: MERGE_APPROVE })),
	);
	expect(textOf(await approved.run)).toBe("Merged PR #7.");
	expect(approved.verdicts).toEqual(["approved"]);
	expect(approved.merged).toEqual(["board"]);
	expect(approved.requests[0]).toMatchObject({
		sessionId: "orch-1",
		kind: "select",
		title: "Merge PR #7 of ThinkRail · board?\nOnly you can approve this.",
		options: [MERGE_DENY, MERGE_APPROVE],
		toolCallId: "call-merge",
		toolInput: { workspace: "board" },
	});

	const denied = await mergeWith((request) =>
		queueMicrotask(() => resolveExtUi({ id: request.id, value: MERGE_DENY })),
	);
	await expect(denied.run).rejects.toThrow("Not merged: denied");
	expect(denied.merged).toEqual([]);
});

test("merge_pr merges nothing when the card times out, the turn stops, or no human can be asked", async () => {
	const timedOut = await mergeWith(() => {}, { timeoutMs: 20 });
	await expect(timedOut.run).rejects.toThrow("Not merged: unanswered");
	expect(timedOut.merged).toEqual([]);
	expect(timedOut.requests.map((request) => request.kind)).toEqual(["select", "dismiss"]);

	const stop = new AbortController();
	const stopped = await mergeWith(() => queueMicrotask(() => stop.abort()), {
		signal: stop.signal,
	});
	await expect(stopped.run).rejects.toThrow("Not merged: unanswered");
	expect(stopped.merged).toEqual([]);

	const headless = await mergeWith(() => {}, { hasUI: false });
	await expect(headless.run).rejects.toThrow("Not merged: unanswered");
	expect(headless.requests).toEqual([]);
});
