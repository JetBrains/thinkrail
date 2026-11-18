import type { McpListResult } from "@thinkrail/contracts";
import { useEffect, useMemo, useState } from "react";
import { type McpWorkspaceProjection, useAppStore } from "@/store";
import { errorText, requestUserMcpList } from "@/transport";

export interface UserMcpList {
	projection: McpWorkspaceProjection | undefined;
	readFailure: string | null;
	retry: () => void;
	refresh: () => void;
	write: (work: () => Promise<McpListResult>) => Promise<McpListResult>;
}

export function userMcpProjection(result: McpListResult): McpWorkspaceProjection {
	return {
		servers: result.servers,
		configErrors: result.configErrors ?? [],
		handledElsewhere: result.handledElsewhere ?? null,
		sessions: {},
	};
}

interface Held {
	generation: number;
	result: McpListResult;
}

export function useUserMcpList(): UserMcpList {
	const connected = useAppStore((s) => s.status === "connected");
	const generation = useAppStore((s) => s.connectionGeneration);
	const welcome = useAppStore((s) => s.welcomeGeneration);
	const [held, setHeld] = useState<Held | null>(null);
	const [readFailure, setReadFailure] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		if (!connected) return;
		let current = true;
		requestUserMcpList("mcp.list", {}).then(
			(result) => {
				if (!current) return;
				setHeld({ generation, result });
				setReadFailure(null);
			},
			(error: unknown) => {
				if (current) setReadFailure(errorText(error));
			},
		);
		return () => {
			current = false;
		};
	}, [connected, generation, welcome, attempt]);

	const projection = useMemo(
		() => (held && held.generation === generation ? userMcpProjection(held.result) : undefined),
		[held, generation],
	);
	const install = (result: McpListResult) =>
		setHeld({ generation: useAppStore.getState().connectionGeneration, result });
	const refresh = () => setAttempt((value) => value + 1);

	return {
		projection,
		readFailure,
		retry: refresh,
		refresh,
		write: (work) =>
			work().then(
				(result) => {
					install(result);
					return result;
				},
				(error: unknown) => {
					refresh();
					throw error;
				},
			),
	};
}
