import type { GitDiffScope } from "@thinkrail/contracts";
import {
	DOUBLE_CLICK_SETTLE_MS,
	layoutResourceIdentity,
	projectRelativePath,
	tupleKey,
} from "../lib";
import {
	type CenterNavigationStamp,
	type ChangesTab,
	createChangesTab,
	type EditorTab,
	isCenterNavigationCurrent,
	layoutOpenOptionsForNavigation,
	selectDiffTabTargetRef,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	selectWorkspaceTick,
	type TabIntent,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { changesTabId, changesTabName, diffTabId, diffTabName } from "./changesModel";

function baseName(path: string): string {
	return path.split("/").pop() || path;
}

const inFlight = new Map<
	string,
	{
		intent: TabIntent;
		claimPreview: boolean;
		navigation: CenterNavigationStamp | null;
		requestedAt: number;
		startedAt: number;
	}
>();

function navTick(workspaceId: string): number {
	return selectWorkspaceNavTick(useAppStore.getState(), workspaceId);
}

async function openReadTab<T>(
	workspaceId: string,
	id: string,
	resourceIdentity: string,
	intent: TabIntent,
	read: () => Promise<T>,
	build: (payload: T, loadedTick: number) => EditorTab,
	requestedNavigation?: CenterNavigationStamp | null,
	claimPreview = false,
): Promise<void> {
	const navigation =
		requestedNavigation === undefined
			? useAppStore.getState().beginCenterNavigation(workspaceId)
			: requestedNavigation;
	const store = useAppStore.getState();
	if (store.removedWorkspaceIds[workspaceId]) return;
	if (intent === "preview" && !isCenterNavigationCurrent(store, workspaceId, navigation)) return;
	const pending = inFlight.get(id);
	if (pending) {
		if (intent === "preview" || claimPreview) pending.claimPreview = true;
		if (intent === "keep") pending.intent = "keep";
		pending.navigation = navigation;
		pending.requestedAt = navTick(workspaceId);
		return;
	}
	const flight = {
		intent,
		claimPreview: intent === "preview" || claimPreview,
		navigation,
		requestedAt: navTick(workspaceId),
		startedAt: Date.now(),
	};
	inFlight.set(id, flight);
	const cached = (store.tabsByWorkspace[workspaceId] ?? []).find(
		(tab) =>
			(tab.kind === "file" || tab.kind === "diff") &&
			layoutResourceIdentity(tab) === resourceIdentity,
	);
	if (cached) {
		try {
			if (flight.intent === "preview") {
				await new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_SETTLE_MS));
			}
			const currentState = useAppStore.getState();
			const latestCached = (currentState.tabsByWorkspace[workspaceId] ?? []).find(
				(tab) =>
					(tab.kind === "file" || tab.kind === "diff") &&
					layoutResourceIdentity(tab) === resourceIdentity,
			);
			if (!latestCached) return;
			const overtaken = flight.navigation
				? !isCenterNavigationCurrent(currentState, workspaceId, flight.navigation)
				: navTick(workspaceId) !== flight.requestedAt;
			if (flight.intent === "preview" && overtaken) return;
			const options = layoutOpenOptionsForNavigation(currentState, workspaceId, flight.navigation);
			useAppStore
				.getState()
				.openTab(
					latestCached,
					flight.intent,
					true,
					flight.intent === "keep" && flight.claimPreview && !overtaken
						? { ...options, claimPreview: true }
						: options,
				);
		} finally {
			inFlight.delete(id);
		}
		return;
	}
	const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
	try {
		const payload = await read();
		if (flight.intent === "preview") {
			const remaining = DOUBLE_CLICK_SETTLE_MS - (Date.now() - flight.startedAt);
			if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
		}
		const currentState = useAppStore.getState();
		const overtaken = flight.navigation
			? !isCenterNavigationCurrent(currentState, workspaceId, flight.navigation)
			: navTick(workspaceId) !== flight.requestedAt;
		if (flight.intent === "preview" && overtaken) return;
		const installedCache = (currentState.tabsByWorkspace[workspaceId] ?? []).find(
			(tab) =>
				(tab.kind === "file" || tab.kind === "diff") &&
				layoutResourceIdentity(tab) === resourceIdentity,
		);
		const tab = installedCache ?? build(payload, loadedTick);
		const options = layoutOpenOptionsForNavigation(currentState, workspaceId, flight.navigation);
		useAppStore
			.getState()
			.openTab(
				tab,
				flight.intent,
				true,
				flight.intent === "keep" && flight.claimPreview && !overtaken
					? { ...options, claimPreview: true }
					: options,
			);
	} catch {
	} finally {
		inFlight.delete(id);
	}
}

export function openFileInTab(
	workspaceId: string,
	reported: string,
	intent: TabIntent,
	requestedNavigation?: CenterNavigationStamp | null,
): Promise<void> {
	const path = projectRelativePath(
		reported,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	const id = tupleKey("file", workspaceId, path);
	return openReadTab(
		workspaceId,
		id,
		layoutResourceIdentity({ kind: "file", id, name: baseName(path), path }),
		intent,
		() => getTransport().request("fs.readFile", { workspaceId, path }),
		({ content, meta }, loadedTick) => ({
			kind: "file",
			id,
			workspaceId,
			path,
			name: baseName(path),
			content,
			meta,
			loadedTick,
		}),
		requestedNavigation,
	);
}

export function openDiffInTab(
	workspaceId: string,
	scope: GitDiffScope,
	path: string,
	intent: TabIntent,
	requestedNavigation?: CenterNavigationStamp | null,
	options: { claimPreview?: boolean } = {},
): Promise<void> {
	const canonicalPath = projectRelativePath(
		path,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	const id = diffTabId(workspaceId, scope, canonicalPath);
	const target = selectDiffTabTargetRef(useAppStore.getState(), { workspaceId, scope });
	return openReadTab(
		workspaceId,
		id,
		layoutResourceIdentity({
			kind: "diff",
			id,
			name: diffTabName(scope, canonicalPath),
			path: canonicalPath,
			scope,
		}),
		intent,
		() => getTransport().request("git.diffFile", { workspaceId, path: canonicalPath, scope }),
		({ original, modified, meta, originalOid }, loadedTick) => ({
			kind: "diff",
			id,
			workspaceId,
			path: canonicalPath,
			scope,
			name: diffTabName(scope, canonicalPath),
			original,
			modified,
			meta,
			originalOid,
			loadedTick,
			loadedTarget: target,
		}),
		requestedNavigation,
		options.claimPreview,
	);
}

export async function openChangesTab(
	workspaceId: string,
	scope: GitDiffScope,
	options: { revealPath?: string | null } = {},
	intent: TabIntent = "preview",
	requestedNavigation?: CenterNavigationStamp | null,
): Promise<void> {
	const navigation =
		requestedNavigation === undefined
			? useAppStore.getState().beginCenterNavigation(workspaceId)
			: requestedNavigation;
	const requestedAt = navTick(workspaceId);
	if (intent === "preview") {
		await new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_SETTLE_MS));
	}
	const state = useAppStore.getState();
	if (state.removedWorkspaceIds[workspaceId]) return;
	const overtaken = navigation
		? !isCenterNavigationCurrent(state, workspaceId, navigation)
		: navTick(workspaceId) !== requestedAt;
	if (intent === "preview" && overtaken) return;
	const id = changesTabId(workspaceId, scope);
	const revealPath = options.revealPath
		? projectRelativePath(options.revealPath, selectWorkspaceById(state, workspaceId)?.worktreePath)
		: null;
	const existing = (state.tabsByWorkspace[workspaceId] ?? []).find(
		(tab): tab is ChangesTab => tab.id === id && tab.kind === "changes",
	);
	const base = existing ?? createChangesTab(workspaceId, id, changesTabName(scope), scope);
	const tab: ChangesTab = revealPath
		? { ...base, reveal: { path: revealPath, tick: (base.reveal?.tick ?? 0) + 1 } }
		: base;
	state.openTab(tab, intent, true, layoutOpenOptionsForNavigation(state, workspaceId, navigation));
}
