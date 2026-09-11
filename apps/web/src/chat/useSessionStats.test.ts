import { expect, test } from "bun:test";
import type { SessionStats } from "@thinkrail/contracts";
import { refreshSessionStats } from "./useSessionStats";

const stats: SessionStats = {
	sessionId: "session-1",
	totalMessages: 3,
	tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, total: 18 },
	cost: 0.01,
	contextUsage: { tokens: 18, contextWindow: 1_000, percent: 1.8 },
};

function dependencies(
	overrides: {
		status?: "connecting" | "connected" | "disconnected";
		connectionGeneration?: number;
		statsRefreshTick?: number;
		read?: () => Promise<SessionStats>;
	} = {},
) {
	let installed: { sessionId: string; stats: SessionStats } | null = null;
	return {
		deps: {
			read: overrides.read ?? (async () => stats),
			state: () => ({
				status: overrides.status ?? ("connected" as const),
				connectionGeneration: overrides.connectionGeneration ?? 4,
				sessions: {
					"session-1": { statsRefreshTick: overrides.statsRefreshTick ?? 7 },
				},
				setStats: (sessionId: string, next: SessionStats) => {
					installed = { sessionId, stats: next };
				},
			}),
		},
		installed: () => installed,
	};
}

function refresh(
	deps: ReturnType<typeof dependencies>["deps"],
	isCurrent: () => boolean = () => true,
) {
	return refreshSessionStats(
		{
			sessionId: "session-1",
			expectedStatsRefreshTick: 7,
			connectionGeneration: 4,
			isCurrent,
		},
		deps,
	);
}

test("refreshSessionStats installs an authoritative current snapshot", async () => {
	const fixture = dependencies();
	expect(await refresh(fixture.deps)).toBe("applied");
	expect(fixture.installed()).toEqual({ sessionId: "session-1", stats });
});

test("refreshSessionStats rejects superseded revisions, generations, identities, and callers", async () => {
	for (const fixture of [
		dependencies({ statsRefreshTick: 8 }),
		dependencies({ connectionGeneration: 5 }),
		dependencies({ status: "disconnected" }),
		dependencies({ read: async () => ({ ...stats, sessionId: "other" }) }),
	]) {
		expect(await refresh(fixture.deps)).toBe("stale");
		expect(fixture.installed()).toBeNull();
	}
	const cancelled = dependencies();
	expect(await refresh(cancelled.deps, () => false)).toBe("stale");
	expect(cancelled.installed()).toBeNull();
});

test("refreshSessionStats keeps the last snapshot when the read fails", async () => {
	const fixture = dependencies({
		read: async () => {
			throw new Error("offline");
		},
	});
	expect(await refresh(fixture.deps)).toBe("failed");
	expect(fixture.installed()).toBeNull();
});
