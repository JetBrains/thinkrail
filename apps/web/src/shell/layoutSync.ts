import type {
	LayoutChangedPayload,
	LayoutReplaceParams,
	WorkspaceLayoutDocument,
	WorkspaceLayoutSnapshot,
} from "@thinkrail/contracts";
import { type LayoutAttention, tupleKey } from "../lib";
import { isConnectedGeneration, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import {
	createLayoutId,
	instantiateLayoutPreset,
	minimumSideGroupLimit,
	reconcileAttention,
	resolveLayoutPreset,
} from "./layout";

const hydration = new Map<string, Promise<WorkspaceLayoutDocument>>();
/** Network writes are serialized per workspace; optimistic projections still install immediately. */
const commitQueues = new Map<string, Promise<void>>();
type LayoutReplaceRequester = (params: LayoutReplaceParams) => Promise<LayoutChangedPayload>;
let layoutReplaceRequesterForTests: LayoutReplaceRequester | null = null;

class SupersededLayoutCommitError extends Error {
	constructor() {
		super("The layout write was superseded by an earlier rollback");
		this.name = "SupersededLayoutCommitError";
	}
}

class SupersededLayoutHydrationError extends Error {
	constructor() {
		super("The layout hydration was superseded by a newer connection");
		this.name = "SupersededLayoutHydrationError";
	}
}

export function isSupersededLayoutHydration(error: unknown): boolean {
	return error instanceof SupersededLayoutHydrationError;
}

function requestLayoutReplace(params: LayoutReplaceParams): Promise<LayoutChangedPayload> {
	return (
		layoutReplaceRequesterForTests?.(params) ?? getTransport().request("layout.replace", params)
	);
}

/** Unit-test seam for deterministic settlement ordering; production always uses the wire singleton. */
export function setLayoutReplaceRequesterForTests(requester: LayoutReplaceRequester | null): void {
	layoutReplaceRequesterForTests = requester;
}

function attentionStorageKey(workspaceId: string): string {
	return `thinkrail:layout-attention:${JSON.stringify([getTransport().httpBase(), workspaceId])}`;
}

function loadAttention(workspaceId: string): LayoutAttention | undefined {
	try {
		const raw = localStorage.getItem(attentionStorageKey(workspaceId));
		if (!raw) return undefined;
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const value = parsed as Record<string, unknown>;
		const selected = value.selectedByGroup;
		const focusedSides = value.lastFocusedSideGroupId;
		const clocks = value.navigationClockByGroup;
		if (
			!selected ||
			typeof selected !== "object" ||
			Array.isArray(selected) ||
			typeof value.lastFocusedCenterGroupId !== "string" ||
			!focusedSides ||
			typeof focusedSides !== "object" ||
			Array.isArray(focusedSides) ||
			!clocks ||
			typeof clocks !== "object" ||
			Array.isArray(clocks)
		) {
			return undefined;
		}
		const selectedByGroup = selected as Record<string, unknown>;
		const lastFocusedSideGroupId = focusedSides as Record<string, unknown>;
		const navigationClockByGroup = clocks as Record<string, unknown>;
		if (
			Object.values(selectedByGroup).some((entry) => typeof entry !== "string") ||
			Object.entries(lastFocusedSideGroupId).some(
				([side, entry]) => (side !== "left" && side !== "right") || typeof entry !== "string",
			) ||
			Object.values(navigationClockByGroup).some(
				(entry) => !Number.isSafeInteger(entry) || Number(entry) < 0,
			)
		) {
			return undefined;
		}
		return {
			selectedByGroup: Object.assign(Object.create(null), selectedByGroup) as Record<
				string,
				string
			>,
			lastFocusedCenterGroupId: value.lastFocusedCenterGroupId,
			lastFocusedSideGroupId: Object.assign(Object.create(null), lastFocusedSideGroupId) as Partial<
				Record<"left" | "right", string>
			>,
			navigationClockByGroup: Object.assign(Object.create(null), navigationClockByGroup) as Record<
				string,
				number
			>,
		};
	} catch {
		return undefined;
	}
}

export function persistLayoutAttention(workspaceId: string, attention: LayoutAttention): void {
	try {
		localStorage.setItem(attentionStorageKey(workspaceId), JSON.stringify(attention));
	} catch {
		// Local attention persistence is best-effort; structural state remains safe on the host.
	}
}

export function installAttentionForDocument(
	workspaceId: string,
	document: WorkspaceLayoutDocument,
	previousDocument?: WorkspaceLayoutDocument,
): LayoutAttention {
	const state = useAppStore.getState();
	const previous = state.layoutAttentionByWorkspace[workspaceId] ?? loadAttention(workspaceId);
	const attention = reconcileAttention(document, previous, previousDocument);
	state.setLayoutAttention(workspaceId, attention);
	persistLayoutAttention(workspaceId, attention);
	return attention;
}

export async function commitWorkspaceLayout(
	workspaceId: string,
	document: WorkspaceLayoutDocument,
): Promise<WorkspaceLayoutSnapshot> {
	const mutationId = createLayoutId("mutation");
	const store = useAppStore.getState();
	if (store.removedWorkspaceIds[workspaceId]) throw new Error("Workspace has been removed");
	const previousDocument = store.layoutDocumentsByWorkspace[workspaceId];
	store.beginLayoutCommit(workspaceId, document, mutationId);
	installAttentionForDocument(workspaceId, document, previousDocument);

	const prior = commitQueues.get(workspaceId) ?? Promise.resolve();
	const operation = prior
		.catch(() => {})
		.then(async () => {
			const queued = useAppStore
				.getState()
				.layoutPendingByWorkspace[workspaceId]?.some(
					(candidate) => candidate.mutationId === mutationId,
				);
			// Rejecting an earlier full snapshot rolls back every dependent projection after it. Those later
			// writes must never reach the host and resurrect state that the browser already rolled back.
			if (!queued) throw new SupersededLayoutCommitError();
			try {
				const current = useAppStore.getState();
				if (current.removedWorkspaceIds[workspaceId]) {
					throw new Error("Workspace has been removed");
				}
				const payload = await requestLayoutReplace({ workspaceId, mutationId, document });
				const settled = useAppStore.getState();
				if (settled.removedWorkspaceIds[workspaceId]) {
					throw new Error("Workspace has been removed");
				}
				settled.applyLayoutChanged(payload);
				return payload.snapshot;
			} catch (error) {
				const state = useAppStore.getState();
				const stillPending = state.layoutPendingByWorkspace[workspaceId]?.some(
					(candidate) => candidate.mutationId === mutationId,
				);
				// The matching broadcast can settle optimism before a response is lost with the socket. In that
				// ordering the write is authoritative success: never roll it back or report a false save failure.
				if (!stillPending && !state.removedWorkspaceIds[workspaceId]) {
					const accepted = state.layoutSnapshotsByWorkspace[workspaceId];
					if (accepted) return accepted;
				}
				state.rejectLayoutCommit(workspaceId, mutationId);
				if (!state.removedWorkspaceIds[workspaceId]) {
					toast.error(errorText(error), "Couldn't save the workspace layout");
				}
				throw error;
			}
		});
	const tail = operation.then(
		() => {},
		() => {},
	);
	commitQueues.set(workspaceId, tail);
	void tail.finally(() => {
		if (commitQueues.get(workspaceId) === tail) commitQueues.delete(workspaceId);
	});
	return operation;
}

export function hydrateWorkspaceLayout(workspaceId: string): Promise<WorkspaceLayoutDocument> {
	const stateAtRequest = useAppStore.getState();
	if (stateAtRequest.removedWorkspaceIds[workspaceId]) {
		return Promise.reject(new Error("Workspace has been removed"));
	}
	const connectionGeneration = stateAtRequest.connectionGeneration;
	const hydrationKey = tupleKey("layout-hydration", workspaceId, String(connectionGeneration));
	const existing = hydration.get(hydrationKey);
	if (existing) return existing;
	const initialSnapshot = stateAtRequest.layoutSnapshotsByWorkspace[workspaceId];
	const request = getTransport()
		.request("layout.get", { workspaceId })
		.then(async (snapshot) => {
			const responseState = useAppStore.getState();
			if (responseState.removedWorkspaceIds[workspaceId]) {
				throw new Error("Workspace has been removed");
			}
			if (!isConnectedGeneration(responseState, connectionGeneration)) {
				throw new SupersededLayoutHydrationError();
			}
			if (snapshot) {
				const state = useAppStore.getState();
				const previousDocument = state.layoutDocumentsByWorkspace[workspaceId];
				state.installLayoutSnapshot(snapshot);
				const current = useAppStore.getState().layoutDocumentsByWorkspace[workspaceId];
				if (!current) throw new Error("The workspace layout could not be installed");
				installAttentionForDocument(workspaceId, current, previousDocument);
				return current;
			}
			const currentState = useAppStore.getState();
			const currentSnapshot = currentState.layoutSnapshotsByWorkspace[workspaceId];
			const racedDocument = currentState.layoutDocumentsByWorkspace[workspaceId];
			if (
				racedDocument &&
				currentSnapshot &&
				(!initialSnapshot || currentSnapshot.revision > initialSnapshot.revision)
			) {
				return racedDocument;
			}
			if (racedDocument) {
				await commitWorkspaceLayout(workspaceId, racedDocument);
				return racedDocument;
			}
			const settings = currentState.layoutSettings;
			const preset = resolveLayoutPreset(settings.defaultPresetId, settings.customPresets);
			const requiredLimit = minimumSideGroupLimit(preset);
			if (requiredLimit > settings.maxSideGroups) {
				await getTransport().request("settings.update", {
					config: { layout: { ...settings, maxSideGroups: requiredLimit } },
				});
				const afterSettings = useAppStore.getState();
				if (afterSettings.removedWorkspaceIds[workspaceId]) {
					throw new Error("Workspace has been removed");
				}
				if (!isConnectedGeneration(afterSettings, connectionGeneration)) {
					throw new SupersededLayoutHydrationError();
				}
			}
			const document = instantiateLayoutPreset(preset);
			await commitWorkspaceLayout(workspaceId, document);
			return document;
		})
		.finally(() => {
			if (hydration.get(hydrationKey) === request) hydration.delete(hydrationKey);
		});
	hydration.set(hydrationKey, request);
	return request;
}

export function resetLayoutSyncForTests(): void {
	hydration.clear();
	commitQueues.clear();
	layoutReplaceRequesterForTests = null;
}
