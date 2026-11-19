import type { SubagentCatalogEntry } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { getTransport } from "@/transport";

export type AgentCatalog = SubagentCatalogEntry[] | "loading" | "failed";
const readCatalog = (workspaceId: string | undefined) =>
	getTransport().request("subagent.list", workspaceId ? { workspaceId } : {});

export function useSubagentCatalog(
	workspaceId: string | undefined,
	trusted: boolean,
	welcomeGeneration: number,
	read = readCatalog,
) {
	const [refreshVersion, setRefreshVersion] = useState(0);
	const key = JSON.stringify([workspaceId, trusted, welcomeGeneration, refreshVersion]);
	const [loaded, setLoaded] = useState<{ key: string; catalog: AgentCatalog } | null>(null);
	useEffect(() => {
		let active = true;
		read(workspaceId).then(
			(entries) => {
				if (active) setLoaded({ key, catalog: entries });
			},
			() => {
				if (active) setLoaded({ key, catalog: "failed" });
			},
		);
		return () => {
			active = false;
		};
	}, [key, workspaceId, read]);
	return {
		catalog: loaded?.key === key ? loaded.catalog : ("loading" as AgentCatalog),
		refresh: () => setRefreshVersion((version) => version + 1),
	};
}
