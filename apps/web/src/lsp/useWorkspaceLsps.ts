import type { DetectedLspServer } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { getNativeLspBridge } from "./nativeLsp";

export type WorkspaceLsps =
	| { state: "unsupported" }
	| { state: "idle" }
	| { state: "loading" }
	| { state: "failed" }
	| { state: "ready"; servers: DetectedLspServer[] };

const POLL_MS = 10_000;

export interface WorkspaceLspsController {
	lsps: WorkspaceLsps;
	refresh(): void;
	/** Stop one server (or all); the next query starts it again. */
	restart(serverId?: string): void;
}

/**
 * Detected language servers for a worktree. Detection never spawns a server; statuses are polled so a
 * server an agent query just started shows up as ready.
 */
export function useWorkspaceLsps(worktreePath: string | undefined): WorkspaceLspsController {
	const bridge = getNativeLspBridge();
	const [lsps, setLsps] = useState<WorkspaceLsps>(
		bridge ? (worktreePath ? { state: "loading" } : { state: "idle" }) : { state: "unsupported" },
	);
	const generation = useRef(0);

	const load = useCallback(
		(show: "loading" | "quiet") => {
			const native = getNativeLspBridge();
			if (!native) return setLsps({ state: "unsupported" });
			if (!worktreePath) return setLsps({ state: "idle" });
			const mine = ++generation.current;
			if (show === "loading") setLsps({ state: "loading" });
			native
				.detect(worktreePath)
				.then((servers) => {
					if (mine === generation.current) setLsps({ state: "ready", servers });
				})
				.catch(() => {
					if (mine === generation.current) setLsps({ state: "failed" });
				});
		},
		[worktreePath],
	);

	useEffect(() => {
		load("loading");
		const timer = setInterval(() => load("quiet"), POLL_MS);
		return () => {
			generation.current++;
			clearInterval(timer);
		};
	}, [load]);

	const restart = useCallback(
		(serverId?: string) => {
			const native = getNativeLspBridge();
			if (!native || !worktreePath) return;
			const mine = ++generation.current;
			native
				.restart(worktreePath, serverId)
				.then((servers) => {
					if (mine === generation.current) setLsps({ state: "ready", servers });
				})
				.catch(() => {
					if (mine === generation.current) setLsps({ state: "failed" });
				});
		},
		[worktreePath],
	);

	return { lsps, refresh: () => load("loading"), restart };
}
