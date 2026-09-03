import type { OpenBranchReview, Workspace } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { type ConnectionStatus, getTransport } from "../transport";
import { type OpenBranchReviewStateStore, openBranchReviewState } from "./openBranchReviewState";

type OpenReviewRequestParams = { workspaceId: string; allowCached?: true };
type OpenReviewRequest = (params: OpenReviewRequestParams) => Promise<OpenBranchReview | null>;

export interface OpenBranchReviewState {
	review: OpenBranchReview | null;
	url?: string;
	noteOpenReview: (review: OpenBranchReview, url?: string) => void;
	refreshOpenReview: () => void;
}

function requestOpenBranchReview(options: {
	workspaceId: string;
	key: string;
	allowCached: boolean;
	request: OpenReviewRequest;
	state: OpenBranchReviewStateStore;
}): void {
	const generation = options.state.beginRequest(options.key);
	void options
		.request({
			workspaceId: options.workspaceId,
			...(options.allowCached ? { allowCached: true as const } : {}),
		})
		.then(
			(review) => {
				options.state.resolveRequest(options.key, generation, review);
			},
			() => {
				options.state.resolveRequest(options.key, generation, null);
			},
		);
}

export function startOpenBranchReviewSync(options: {
	workspaceId: string;
	key: string;
	request: OpenReviewRequest;
	state: OpenBranchReviewStateStore;
	focusTarget: EventTarget;
	connected: boolean;
}): { setConnected: (connected: boolean) => void; refresh: () => void; stop: () => void } {
	let connected = options.connected;
	let freshOnReconnect = false;
	const load = (allowCached: boolean) =>
		requestOpenBranchReview({
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
	return { setConnected, refresh, stop };
}

const transportRequest: OpenReviewRequest = (params) =>
	getTransport().request("workspace.openReview", params);

type OpenBranchReviewSync = ReturnType<typeof startOpenBranchReviewSync>;

export function useOpenBranchReview(
	workspace: Workspace | null,
	status: ConnectionStatus,
): OpenBranchReviewState {
	const workspaceId = workspace?.id ?? null;
	const key = workspace ? `${workspace.id}\0${workspace.branch}` : null;
	const currentKey = useRef(key);
	const connected = status === "connected";
	const connectedRef = useRef(connected);
	const sync = useRef<OpenBranchReviewSync | null>(null);
	currentKey.current = key;
	connectedRef.current = connected;
	const subscribe = useCallback(
		(listener: () => void) => (key ? openBranchReviewState.subscribe(key, listener) : () => {}),
		[key],
	);
	const getSnapshot = useCallback(
		() => (key ? openBranchReviewState.getSnapshot(key) : null),
		[key],
	);
	const loaded = useSyncExternalStore(subscribe, getSnapshot, () => null);

	useEffect(() => {
		if (!workspaceId || !key) {
			sync.current = null;
			return;
		}
		const controller = startOpenBranchReviewSync({
			workspaceId,
			key,
			request: transportRequest,
			state: openBranchReviewState,
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

	const noteOpenReview = useCallback(
		(review: OpenBranchReview, url?: string) => {
			if (key && currentKey.current === key) openBranchReviewState.noteOpenReview(key, review, url);
		},
		[key],
	);
	const refreshOpenReview = useCallback(() => {
		if (key && currentKey.current === key) sync.current?.refresh();
	}, [key]);

	const current = connected ? loaded : null;
	return {
		review: current?.review ?? null,
		...(current?.url ? { url: current.url } : {}),
		noteOpenReview,
		refreshOpenReview,
	};
}

export function openReviewLabel(review: OpenBranchReview): string {
	return review.kind === "pull-request" ? `PR #${review.number}` : `MR !${review.number}`;
}
