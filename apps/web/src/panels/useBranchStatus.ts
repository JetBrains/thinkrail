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
	type BranchStatusSnapshot,
	type BranchStatusStateStore,
	branchStatusState,
	withDivergence,
} from "./branchStatusState";
import { createSingleFlight } from "./singleFlight";

type BranchStatusRequestParams = { workspaceId: string; allowCached?: true; skipFetch?: true };

export const CI_POLL_INTERVAL_MS = 20_000;
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
	skipFetch?: boolean;
	request: BranchStatusRequest;
	state: BranchStatusStateStore;
}): Promise<void> {
	const request = options.state.beginRequest(options.key, { supersede: !options.allowCached });
	return options
		.request({
			workspaceId: options.workspaceId,
			...(options.allowCached ? { allowCached: true as const } : {}),
			...(options.skipFetch ? { skipFetch: true as const } : {}),
		})
		.then(
			(answer) => {
				options.state.resolveRequest(options.key, request, answer);
			},
			() => {
				options.state.failRequest(options.key, request);
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
	poll: () => void;
	stop: () => void;
} {
	let connected = options.connected;
	let freshOnReconnect = false;
	const cachedReads = createSingleFlight();
	const load = (allowCached: boolean, skipFetch = false) =>
		requestBranchStatus({
			workspaceId: options.workspaceId,
			key: options.key,
			allowCached,
			skipFetch,
			request: options.request,
			state: options.state,
		});
	const loadFresh = (skipFetch = false) => void load(false, skipFetch);
	const reload = () => {
		if (connected) cachedReads.run(() => (connected ? load(true) : undefined));
	};
	const poll = () => {
		if (connected) loadFresh(true);
	};
	const refresh = () => {
		if (connected) loadFresh();
		else freshOnReconnect = true;
	};
	const setConnected = (next: boolean) => {
		if (connected === next) return;
		connected = next;
		if (!connected) return;
		if (freshOnReconnect) loadFresh();
		else reload();
		freshOnReconnect = false;
	};
	const stop = () => {
		cachedReads.stop();
		options.focusTarget.removeEventListener("focus", refresh);
	};

	reload();
	options.focusTarget.addEventListener("focus", refresh);
	return { setConnected, refresh, reload, poll, stop };
}

export function startCiPoll(options: {
	poll: () => void;
	visible: () => boolean;
	intervalMs?: number;
	setInterval?: (run: () => void, ms: number) => unknown;
	clearInterval?: (handle: unknown) => void;
}): () => void {
	const every = options.setInterval ?? ((run, ms) => globalThis.setInterval(run, ms));
	const clear =
		options.clearInterval ??
		((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
	const handle = every(() => {
		if (options.visible()) options.poll();
	}, options.intervalMs ?? CI_POLL_INTERVAL_MS);
	return () => clear(handle);
}

export function ciPollWanted(snapshot: BranchStatusSnapshot | null): boolean {
	const review = snapshot?.review;
	if (!review || !isOpenBranchReview(review) || !review.details) return false;
	return (review.details.checks?.pending ?? 0) > 0 || (snapshot.discovery ?? 0) > 0;
}

export function supportsBranchStatus(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= BRANCH_STATUS_PROTOCOL_VERSION;
}

export function branchAnswer({ review, ...facts }: BranchStatus): BranchAnswer {
	return { review: review ? withDivergence(review, facts) : null, status: facts };
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
	options: { pollChecks?: boolean } = {},
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

	const pollChecks = options.pollChecks === true && connected && ciPollWanted(loaded);
	useEffect(() => {
		if (!pollChecks || !key) return;
		return startCiPoll({
			poll: () => {
				branchStatusState.spendDiscovery(key);
				sync.current?.poll();
			},
			visible: () => document.visibilityState === "visible",
		});
	}, [pollChecks, key]);

	const noteOpenReview = useCallback(
		(review: OpenBranchReview, url?: string) => {
			if (key && currentKey.current === key) branchStatusState.noteOpenReview(key, review, url);
		},
		[key],
	);
	const refreshBranchStatus = useCallback(() => {
		if (!key || currentKey.current !== key) return;
		branchStatusState.startDiscovery(key);
		sync.current?.refresh();
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
			...(lookup.details ? { details: lookup.details } : {}),
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
