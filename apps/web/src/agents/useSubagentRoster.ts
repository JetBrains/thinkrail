import {
	SUBAGENT_ROSTER_PROTOCOL_VERSION,
	type SubagentRoster,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";

export interface SubagentRosterState {
	/** False on hosts older than `SUBAGENT_ROSTER_PROTOCOL_VERSION`: hide the surface, never show 0. */
	supported: boolean;
	roster: SubagentRoster | null;
	stop: (parentSessionId: string, childSessionId: string) => void;
}

/**
 * Workspace-wide subagent roster. Reads `subagent.roster`, then refetches on the throttled
 * `subagent.rosterChanged` invalidation and after every reconnect. Keeps no store copy.
 */
export function useSubagentRoster(workspaceId: string): SubagentRosterState {
	const status = useAppStore((state) => state.status);
	const generation = useAppStore((state) => state.connectionGeneration);
	const protocol = useAppStore((state) => state.protocolVersion);
	const supported = protocol !== null && protocol >= SUBAGENT_ROSTER_PROTOCOL_VERSION;
	const [roster, setRoster] = useState<SubagentRoster | null>(null);

	useEffect(() => {
		setRoster(null);
		if (status !== "connected" || !supported) return;
		const transport = getTransport();
		let disposed = false;
		let reading = false;
		let again = false;
		const read = () => {
			if (reading) {
				again = true;
				return;
			}
			reading = true;
			transport
				.request("subagent.roster", { workspaceId })
				.then((next) => {
					if (disposed) return;
					setRoster((prev) =>
						prev && prev.revision > next.revision && prev.workspaceId === next.workspaceId
							? prev
							: next,
					);
				})
				.catch(() => {})
				.finally(() => {
					reading = false;
					if (again && !disposed) {
						again = false;
						read();
					}
				});
		};
		const unsubscribe = transport.subscribe(WS_CHANNELS.subagentRosterChanged, (payload) => {
			if ((payload as { workspaceId?: string }).workspaceId === workspaceId) read();
		});
		read();
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [workspaceId, status, supported, generation]);

	const stop = useCallback(
		(parentSessionId: string, childSessionId: string) => {
			void getTransport()
				.request("subagent.stop", { workspaceId, parentSessionId, childSessionId })
				.catch(() => {});
		},
		[workspaceId],
	);

	return { supported, roster, stop };
}
