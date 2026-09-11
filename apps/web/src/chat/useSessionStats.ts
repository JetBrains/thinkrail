import type { SessionStats } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef } from "react";
import type { SessionRuntime } from "../store";
import { isConnectedGeneration, useAppStore } from "../store";
import { type ConnectionStatus, getTransport } from "../transport";

interface SessionStatsRefreshState {
	status: ConnectionStatus;
	connectionGeneration: number;
	sessions: Record<string, Pick<SessionRuntime, "statsRefreshTick"> | undefined>;
	setStats: (sessionId: string, stats: SessionStats) => void;
}

interface SessionStatsRefreshDependencies {
	read: (sessionId: string) => Promise<SessionStats>;
	state: () => SessionStatsRefreshState;
}

interface SessionStatsRefreshInput {
	sessionId: string;
	expectedStatsRefreshTick: number;
	connectionGeneration: number;
	isCurrent: () => boolean;
}

const sessionStatsRefreshDependencies: SessionStatsRefreshDependencies = {
	read: (sessionId) => getTransport().request("session.getStats", { sessionId }),
	state: useAppStore.getState,
};

export async function refreshSessionStats(
	input: SessionStatsRefreshInput,
	deps: SessionStatsRefreshDependencies = sessionStatsRefreshDependencies,
): Promise<"applied" | "failed" | "stale"> {
	let stats: SessionStats;
	try {
		stats = await deps.read(input.sessionId);
	} catch {
		return "failed";
	}
	const state = deps.state();
	if (
		!input.isCurrent() ||
		!isConnectedGeneration(state, input.connectionGeneration) ||
		state.sessions[input.sessionId]?.statsRefreshTick !== input.expectedStatsRefreshTick ||
		stats.sessionId !== input.sessionId
	) {
		return "stale";
	}
	state.setStats(input.sessionId, stats);
	return "applied";
}

export function useSessionStats({
	sessionId,
	statsRefreshTick,
	syncedConnectionGeneration,
	status,
	connectionGeneration,
	enabled = true,
}: {
	sessionId: string;
	statsRefreshTick: number;
	syncedConnectionGeneration: number;
	status: ConnectionStatus;
	connectionGeneration: number;
	enabled?: boolean;
}): () => void {
	const activeSession = useRef<string | null>(null);
	const readGeneration = useRef(0);
	const run = useCallback(
		(expectedStatsRefreshTick: number, expectedConnectionGeneration: number) => {
			const mine = ++readGeneration.current;
			void refreshSessionStats({
				sessionId,
				expectedStatsRefreshTick,
				connectionGeneration: expectedConnectionGeneration,
				isCurrent: () => activeSession.current === sessionId && readGeneration.current === mine,
			});
		},
		[sessionId],
	);

	useEffect(() => {
		activeSession.current = enabled ? sessionId : null;
		return () => {
			if (activeSession.current === sessionId) activeSession.current = null;
			readGeneration.current += 1;
		};
	}, [enabled, sessionId]);

	useEffect(() => {
		if (!enabled || status !== "connected") return;
		run(statsRefreshTick, connectionGeneration);
		return () => {
			readGeneration.current += 1;
		};
	}, [connectionGeneration, enabled, run, statsRefreshTick, status, syncedConnectionGeneration]);

	return useCallback(() => {
		if (activeSession.current !== sessionId) return;
		const state = useAppStore.getState();
		const runtime = state.sessions[sessionId];
		if (state.status !== "connected" || !runtime) return;
		run(runtime.statsRefreshTick, state.connectionGeneration);
	}, [run, sessionId]);
}
