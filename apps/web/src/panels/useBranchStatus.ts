import {
	BRANCH_STATUS_PROTOCOL_VERSION,
	type BranchStatus,
	type OpenBranchReview,
	type Workspace,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useAppStore } from "../store";
import { type ConnectionStatus, getTransport } from "../transport";
import {
	type BranchAnswer,
	type BranchFacts,
	type BranchStatusStateStore,
	branchStatusState,
} from "./branchStatusState";

type BranchStatusRequestParams = { workspaceId: string; allowCached?: true };
type BranchStatusRequest = (params: BranchStatusRequestParams) => Promise<BranchAnswer>;

export interface BranchStatusHookState {
	review: OpenBranchReview | null;
	url?: string;
	status: BranchFacts | null;
	noteOpenReview: (review: OpenBranchReview, url?: string) => void;
	refreshBranchStatus: () => void;
}

function requestBranchStatus(options: {
	workspaceId: string;
	key: string;
	allowCached: boolean;
	request: BranchStatusRequest;
	state: BranchStatusStateStore;
}): void {
	const generation = options.state.beginRequest(options.key);
	void options
		.request({
			workspaceId: options.workspaceId,
			...(options.allowCached ? { allowCached: true as const } : {}),
		})
		.then(
			(answer) => {
				options.state.resolveRequest(options.key, generation, answer);
			},
			() => {
				options.state.resolveRequest(options.key, generation, { review: null, status: null });
			},
		);
}

export function startBranchStatusSync(options: {
	workspaceId: string;
	key: string;
	request: BranchStatusRequest;
	state: BranchStatusStateStore;
	focusTarget: EventTarget;
	connected: boolean;
}): {
	setConnected: (connected: boolean) => void;
	refresh: () => void;
	reload: () => void;
	stop: () => void;
} {
	let connected = options.connected;
	let freshOnReconnect = false;
	const load = (allowCached: boolean) =>
		requestBranchStatus({
			workspaceId: options.workspaceId,
			key: options.key,
			allowCached,
			request: options.request,
			state: options.state,
		});
	const refresh = () => {
		if (connected) load(false);
		else freshOnReconnect = true;
	};
	const reload = () => {
		if (connected) load(true);
	};
	const setConnected = (next: boolean) => {
		if (connected === next) return;
		connected = next;
		if (!connected) return;
		load(!freshOnReconnect);
		freshOnReconnect = false;
	};
	const stop = () => options.focusTarget.removeEventListener("focus", refresh);

	if (connected) load(true);
	options.focusTarget.addEventListener("focus", refresh);
	return { setConnected, refresh, reload, stop };
}

export function supportsBranchStatus(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= BRANCH_STATUS_PROTOCOL_VERSION;
}

export function branchAnswer({ review, ...facts }: BranchStatus): BranchAnswer {
	const ahead = facts.ahead ?? 0;
	const behind = facts.behind ?? 0;
	return {
		review: review
			? {
					...review,
					...(ahead > 0 ? { unpushedCommits: ahead } : {}),
					...(behind > 0 ? { behindCommits: behind } : {}),
				}
			: null,
		status: facts,
	};
}

const transportRequest: BranchStatusRequest = async (params) => {
	if (supportsBranchStatus(useAppStore.getState().protocolVersion)) {
		return branchAnswer(await getTransport().request("workspace.branchStatus", params));
	}
	return { review: await getTransport().request("workspace.openReview", params), status: null };
};

type BranchStatusSync = ReturnType<typeof startBranchStatusSync>;

export function useBranchStatus(
	workspace: Workspace | null,
	status: ConnectionStatus,
): BranchStatusHookState {
	const workspaceId = workspace?.id ?? null;
	const key = workspace ? `${workspace.id}\0${workspace.branch}` : null;
	const currentKey = useRef(key);
	const connected = useAppStore((s) => status === "connected" && s.protocolVersion !== null);
	const connectedRef = useRef(connected);
	const sync = useRef<BranchStatusSync | null>(null);
	currentKey.current = key;
	connectedRef.current = connected;
	const subscribe = useCallback(
		(listener: () => void) => (key ? branchStatusState.subscribe(key, listener) : () => {}),
		[key],
	);
	const getSnapshot = useCallback(() => (key ? branchStatusState.getSnapshot(key) : null), [key]);
	const loaded = useSyncExternalStore(subscribe, getSnapshot, () => null);

	useEffect(() => {
		if (!workspaceId || !key) {
			sync.current = null;
			return;
		}
		const controller = startBranchStatusSync({
			workspaceId,
			key,
			request: transportRequest,
			state: branchStatusState,
			focusTarget: window,
			connected: connectedRef.current,
		});
		sync.current = controller;
		return () => {
			controller.stop();
			if (sync.current === controller) sync.current = null;
		};
	}, [key, workspaceId]);

	useEffect(() => {
		sync.current?.setConnected(connected);
	}, [connected]);

	const fsTick = useAppStore((s) =>
		workspaceId ? (s.fsChangesByWorkspace[workspaceId]?.tick ?? 0) : 0,
	);
	const lastFsTick = useRef<{ key: string | null; tick: number }>({ key: null, tick: 0 });
	useEffect(() => {
		if (!workspaceId || !key) return;
		if (lastFsTick.current.key !== key) {
			lastFsTick.current = { key, tick: fsTick };
			return;
		}
		if (fsTick === lastFsTick.current.tick) return;
		lastFsTick.current = { key, tick: fsTick };
		sync.current?.reload();
	}, [fsTick, key, workspaceId]);

	const noteOpenReview = useCallback(
		(review: OpenBranchReview, url?: string) => {
			if (key && currentKey.current === key) branchStatusState.noteOpenReview(key, review, url);
		},
		[key],
	);
	const refreshBranchStatus = useCallback(() => {
		if (key && currentKey.current === key) sync.current?.refresh();
	}, [key]);

	const current = connected ? loaded : null;
	return {
		review: current?.review ?? null,
		...(current?.url ? { url: current.url } : {}),
		status: current?.status ?? null,
		noteOpenReview,
		refreshBranchStatus,
	};
}

export function resolveBranchReview(
	lookup: OpenBranchReview | null,
	snapshot: OpenBranchReview | null | undefined,
	snapshotAuthoritative = false,
): { review: OpenBranchReview | null; detailsKnown: boolean } {
	if (!snapshotAuthoritative) {
		return { review: lookup, detailsKnown: lookup !== null };
	}
	if (!snapshot) return { review: null, detailsKnown: false };
	const sameReview =
		lookup !== null &&
		lookup.kind === snapshot.kind &&
		lookup.number === snapshot.number &&
		(lookup.state ?? "open") === (snapshot.state ?? "open");
	if (!sameReview) return { review: snapshot, detailsKnown: false };
	return {
		review: {
			...snapshot,
			...(lookup.url ? { url: lookup.url } : {}),
			...(lookup.unpushedCommits !== undefined ? { unpushedCommits: lookup.unpushedCommits } : {}),
			...(lookup.behindCommits !== undefined ? { behindCommits: lookup.behindCommits } : {}),
		},
		detailsKnown: true,
	};
}

/** A pre-v78 host never reported anything but open reviews, so an absent `state` reads as open. */
export function isOpenBranchReview(review: OpenBranchReview): boolean {
	return review.state === undefined || review.state === "open";
}

export function openReviewLabel(review: OpenBranchReview): string {
	return review.kind === "pull-request" ? `PR #${review.number}` : `MR !${review.number}`;
}
