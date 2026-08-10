import type {
	WorkspaceFsChangedPayload,
	WorkspaceWatchReadyResult,
	WsParams,
	WsResult,
} from "@thinkrail/contracts";
import { selectWorkspaceTick, useAppStore } from "../store";
import { getTransport } from "./wireTransport";

export interface SkillLoadDependencies {
	watchReady: (workspaceId: string) => Promise<WorkspaceWatchReadyResult>;
	noteFsChanged: (payload: WorkspaceFsChangedPayload) => void;
	workspaceTick: (workspaceId: string) => number;
	createSession: (params: WsParams<"session.create">) => Promise<WsResult<"session.create">>;
	getSessionMessages: (
		params: WsParams<"session.getMessages">,
	) => Promise<WsResult<"session.getMessages">>;
	reloadSessionResources: (
		params: WsParams<"session.reloadResources">,
	) => Promise<WsResult<"session.reloadResources">>;
}

/**
 * Build the three guarded session-resource requests around one per-workspace preparation flight.
 * `startupNudge` is folded even when the normal push arrived: the duplicate is idempotent, while this
 * response survives reconnect replay and therefore closes the lost-push gap before the baseline is read.
 */
export function createSkillLoadRequests(deps: SkillLoadDependencies) {
	const pending = new Map<string, Promise<number>>();

	const prepare = (workspaceId: string): Promise<number> => {
		const existing = pending.get(workspaceId);
		if (existing) return existing;

		const started = deps.watchReady(workspaceId).then(({ startupNudge }) => {
			if (startupNudge) {
				deps.noteFsChanged({ workspaceId, paths: [], truncated: true });
			}
			return deps.workspaceTick(workspaceId);
		});
		const preparation = started.finally(() => {
			if (pending.get(workspaceId) === preparation) pending.delete(workspaceId);
		});
		pending.set(workspaceId, preparation);
		return preparation;
	};

	return {
		async createSession(params: WsParams<"session.create">) {
			const syncedTick = await prepare(params.workspaceId);
			const result = await deps.createSession(params);
			return { result, syncedTick };
		},
		async getSessionMessages(params: WsParams<"session.getMessages">) {
			const syncedTick = await prepare(params.workspaceId);
			const result = await deps.getSessionMessages(params);
			return { result, syncedTick };
		},
		async reloadSessionResources(workspaceId: string, params: WsParams<"session.reloadResources">) {
			const syncedTick = await prepare(workspaceId);
			const result = await deps.reloadSessionResources(params);
			return { result, syncedTick };
		},
	};
}

const skillLoadRequests = createSkillLoadRequests({
	watchReady: (workspaceId) => getTransport().request("workspace.watchReady", { workspaceId }),
	noteFsChanged: (payload) => useAppStore.getState().noteFsChanged(payload),
	workspaceTick: (workspaceId) => selectWorkspaceTick(useAppStore.getState(), workspaceId),
	createSession: (params) => getTransport().request("session.create", params),
	getSessionMessages: (params) => getTransport().request("session.getMessages", params),
	reloadSessionResources: (params) => getTransport().request("session.reloadResources", params),
});

export const createSessionWithSkillBaseline = skillLoadRequests.createSession;
export const getSessionMessagesWithSkillBaseline = skillLoadRequests.getSessionMessages;
export const reloadSessionResourcesWithSkillBaseline = skillLoadRequests.reloadSessionResources;
