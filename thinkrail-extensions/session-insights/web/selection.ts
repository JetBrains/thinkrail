import type { PanelHost } from "@thinkrail/extension-api/web";
import type { Translator } from "@thinkrail/locales/react";
import type { SessionListRow } from "@thinkrail/pi-session-insights/core";
import { sessionName } from "./copy";
import { openComparison } from "./load";

/** A ticked session with what the selection bar shows, so the bar names it while it is out of view. */
export interface SessionPick {
	sessionId: string;
	title: string | null;
	firstPrompt: string | null;
	start: number | null;
	calls: number | null;
	labels: readonly string[];
}

export function pickOf(row: SessionListRow, labels: readonly string[]): SessionPick {
	return {
		sessionId: row.sessionId,
		title: row.title,
		firstPrompt: row.firstPrompt,
		start: row.start.value,
		calls: row.toolCalls.value,
		labels,
	};
}

/** Ticks a session, or unticks it if it was ticked; the picks keep the order they were ticked in. */
export function togglePick(picks: readonly SessionPick[], pick: SessionPick): SessionPick[] {
	return picks.some((item) => item.sessionId === pick.sessionId)
		? picks.filter((item) => item.sessionId !== pick.sessionId)
		: [...picks, pick];
}

/** Swaps A and B; only two picks have sides. */
export function swapPicks(picks: readonly SessionPick[]): readonly SessionPick[] {
	const [a, b] = picks;
	return picks.length === 2 && a && b ? [b, a] : picks;
}

/** The two sides of a comparison, A ticked first: exactly two picks, else `null`. */
export function comparedPair(
	picks: readonly SessionPick[],
): readonly [SessionPick, SessionPick] | null {
	const [a, b] = picks;
	return picks.length === 2 && a && b ? [a, b] : null;
}

/** Opens the A ↔ B comparison tab of exactly two picks, named after both; `false` otherwise. */
export function openPicked(host: PanelHost, t: Translator, picks: readonly SessionPick[]): boolean {
	const pair = comparedPair(picks);
	if (!pair) return false;
	const [a, b] = pair;
	openComparison(
		host,
		t,
		{ sessionId: a.sessionId, name: sessionName(t, a) },
		{ sessionId: b.sessionId, name: sessionName(t, b) },
	);
	return true;
}
