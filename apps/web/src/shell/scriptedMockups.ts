import { isMockupPath } from "@thinkrail/contracts";
import { strArg } from "@thinkrail/extension-api/web";
import type { ChatTurn } from "../chat/types";
import { selectWorkspaceSessionIds, type useAppStore } from "../store";

const VISUALIZE_TOOL = "visualize";

type AppState = ReturnType<typeof useAppStore.getState>;

interface MockupTrustState
	extends Pick<
		AppState,
		"tabsByWorkspace" | "closedChatsByWorkspace" | "layoutDocumentsByWorkspace"
	> {
	sessions: Record<string, Pick<AppState["sessions"][string], "turns" | "toolResults">>;
}

interface VisualizeCall {
	id: string;
	paths: readonly string[];
}

const NO_CALLS: readonly VisualizeCall[] = [];
const callsByTurn = new WeakMap<ChatTurn, readonly VisualizeCall[]>();

function visualizeCalls(turn: ChatTurn): readonly VisualizeCall[] {
	if (turn.kind !== "assistant") return NO_CALLS;
	const cached = callsByTurn.get(turn);
	if (cached) return cached;
	const calls = turn.message.content.flatMap((block) =>
		block.type === "toolCall" && block.name === VISUALIZE_TOOL
			? [
					{
						id: block.id,
						paths: [strArg(block.arguments, "path"), strArg(block.arguments, "before")],
					},
				]
			: [],
	);
	callsByTurn.set(turn, calls);
	return calls;
}

/** A mockup may run scripts only after a successful `visualize` call in this workspace showed it. */
export function isVisualizedMockup(state: MockupTrustState, workspaceId: string, path: string) {
	if (!isMockupPath(path)) return false;
	return selectWorkspaceSessionIds(state, workspaceId).some((sessionId) => {
		const runtime = state.sessions[sessionId];
		if (!runtime) return false;
		return runtime.turns.some((turn) =>
			visualizeCalls(turn).some(
				(call) => call.paths.includes(path) && runtime.toolResults[call.id]?.status === "done",
			),
		);
	});
}

/** Electrobun's preload global: its native bridge accepts messages from any frame, sandboxed or not. */
export function hasDesktopBridge(scope: object) {
	return Reflect.get(scope, "__electrobun") !== undefined;
}
