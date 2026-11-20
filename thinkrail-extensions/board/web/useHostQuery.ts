import type { PanelHost } from "@thinkrail/extension-api/web";
import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { BOARD_ACTIVITY, BOARD_CHANGED } from "./api";

export type Loaded<T> =
	| { kind: "loading" }
	| { kind: "ready"; value: T; busy: boolean }
	| { kind: "error"; disabled: boolean; message: string };

interface Settled<T> {
	key: string;
	attempt: number;
	value?: T;
	error?: unknown;
}

function failure(error: unknown): { disabled: boolean; message: string } {
	const coded = typeof error === "object" && error !== null ? (error as { code?: unknown }) : {};
	return {
		disabled: coded.code === "EXTENSION_DISABLED",
		message: error instanceof Error ? error.message : String(error),
	};
}

/**
 * One query per `key` (`null`: none), asked again on `reload`. While a reload or a new key loads, the
 * last answer for the same key stays shown with `busy`, so a refresh never flashes a skeleton.
 */
export function useHostQuery<T>(
	key: string | null,
	run: (signal: AbortSignal) => Promise<T>,
): { state: Loaded<T>; reload: () => void } {
	const [attempt, setAttempt] = useState(0);
	const [settled, setSettled] = useState<Settled<T> | null>(null);
	const [last, setLast] = useState<{ key: string; value: T } | null>(null);
	const request = useEffectEvent(run);
	useEffect(() => {
		if (key === null) return;
		const controller = new AbortController();
		request(controller.signal).then(
			(value) => {
				if (controller.signal.aborted) return;
				setSettled({ key, attempt, value });
				setLast({ key, value });
			},
			(error: unknown) => {
				if (!controller.signal.aborted) setSettled({ key, attempt, error });
			},
		);
		return () => controller.abort();
	}, [attempt, key]);
	const reload = useCallback(() => setAttempt((value) => value + 1), []);
	if (key === null) return { state: { kind: "loading" }, reload };
	if (settled?.key === key && settled.attempt === attempt) {
		if ("error" in settled) return { state: { kind: "error", ...failure(settled.error) }, reload };
		return { state: { kind: "ready", value: settled.value as T, busy: false }, reload };
	}
	if (last?.key === key) return { state: { kind: "ready", value: last.value, busy: true }, reload };
	return { state: { kind: "loading" }, reload };
}

function useProjectEvent(
	host: Pick<PanelHost, "onEvent">,
	type: string,
	projectId: string | null,
	onEvent: () => void,
): void {
	const fire = useEffectEvent(onEvent);
	useEffect(() => {
		if (projectId === null) return;
		return host.onEvent(type, (payload) => {
			const event = typeof payload === "object" && payload !== null ? payload : {};
			if ((event as { projectId?: unknown }).projectId === projectId) fire();
		});
	}, [host, type, projectId]);
}

/** Calls `onChange` on every `board.changed` the server half publishes for `projectId`. */
export function useBoardChanged(
	host: Pick<PanelHost, "onEvent">,
	projectId: string | null,
	onChange: () => void,
): void {
	useProjectEvent(host, BOARD_CHANGED, projectId, onChange);
}

/** Calls `onActivity` on every `board.activity` of `projectId`: a bound chat's tool start, for the last action. */
export function useBoardActivity(
	host: Pick<PanelHost, "onEvent">,
	projectId: string | null,
	onActivity: () => void,
): void {
	useProjectEvent(host, BOARD_ACTIVITY, projectId, onActivity);
}

/** Calls `onChange` on every `board.changed` of any project: a write, or a bound chat's state or PR. */
export function useAnyBoardChanged(host: Pick<PanelHost, "onEvent">, onChange: () => void): void {
	const changed = useEffectEvent(onChange);
	useEffect(() => host.onEvent(BOARD_CHANGED, () => changed()), [host]);
}

/** Calls `onActivity` on every `board.activity` of any project: a bound chat's tool start. */
export function useAnyBoardActivity(
	host: Pick<PanelHost, "onEvent">,
	onActivity: () => void,
): void {
	const fire = useEffectEvent(onActivity);
	useEffect(() => host.onEvent(BOARD_ACTIVITY, () => fire()), [host]);
}
