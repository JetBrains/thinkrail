import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	LabelsGetParams,
	LabelsGetQuery,
	LabelsGetResult,
	LabelsSetParams,
	LabelsSetQuery,
	LabelsSetResult,
} from "@thinkrail/pi-session-insights/core";
import { useEffect, useState } from "react";
import { API_VERSION } from "../load";
import { VersionSkew } from "../session/api";

export const LABELS_GET: LabelsGetQuery = "labels.get";
export const LABELS_SET: LabelsSetQuery = "labels.set";

/** Offered as one-click labels beside the user's own. */
export const QUICK_LABELS: readonly string[] = ["good", "bad"];

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isLabels(value: unknown): value is LabelsGetResult {
	return (
		isObject(value) &&
		value.apiVersion === API_VERSION &&
		Array.isArray(value.sessions) &&
		Array.isArray(value.vocabulary)
	);
}

function isSet(value: unknown): value is LabelsSetResult {
	return isObject(value) && value.apiVersion === API_VERSION && typeof value.ok === "boolean";
}

export async function loadLabels(
	host: PanelHost,
	sessionIds: readonly string[] | null,
	signal?: AbortSignal,
): Promise<LabelsGetResult> {
	const params: LabelsGetParams = sessionIds ? { sessionIds } : {};
	const value = await host.query(LABELS_GET, params, signal);
	if (!isLabels(value)) throw new VersionSkew();
	return value;
}

export async function saveLabels(
	host: PanelHost,
	params: LabelsSetParams,
): Promise<LabelsSetResult> {
	const value = await host.query(LABELS_SET, params);
	if (!isSet(value)) throw new VersionSkew();
	return value;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Tells every panel of this web half that a session's labels changed (they share the module). */
export function announceLabelsChanged(): void {
	for (const listener of listeners) listener();
}

export function onLabelsChanged(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * The user's labels as the server keeps them (with the notes of `sessionIds`), re-read whenever any
 * panel saves; `null` until the first answer or when the host cannot answer.
 */
export function useLabels(
	host: PanelHost,
	sessionIds: readonly string[] | null,
	enabled: boolean,
): LabelsGetResult | null {
	const key = sessionIds ? sessionIds.join("\u0000") : "";
	const [state, setState] = useState<{ key: string; value: LabelsGetResult } | null>(null);
	const [generation, setGeneration] = useState(0);
	useEffect(() => onLabelsChanged(() => setGeneration((current) => current + 1)), []);
	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		const ids = key ? key.split("\u0000") : null;
		loadLabels(host, ids, controller.signal).then(
			(value) => {
				if (!controller.signal.aborted) setState({ key, value });
			},
			() => {},
		);
		return () => controller.abort();
	}, [enabled, generation, host, key]);
	return state?.key === key ? state.value : null;
}
