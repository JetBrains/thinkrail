import { useState } from "react";
import { selectArtifactsTick, supportsArtifacts, useAppStore } from "../store";
import { getTransport } from "../transport";
import { useWorkspaceRead } from "./useWorkspaceRead";

export function useWorkspaceArtifacts(workspaceId: string): {
	failed: boolean;
	reload: () => void;
} {
	const supported = useAppStore((s) => supportsArtifacts(s.protocolVersion));
	const [failedFor, setFailedFor] = useState<string | null>(null);
	const { reload } = useWorkspaceRead(
		supported ? workspaceId : null,
		(id) => getTransport().request("artifacts.list", { workspaceId: id }),
		{
			onResult: (snapshot, id) => {
				useAppStore.getState().setWorkspaceArtifacts(id, snapshot);
				setFailedFor(null);
			},
			onFailure: (id) => setFailedFor(id),
		},
		undefined,
		selectArtifactsTick,
	);
	return { failed: failedFor === workspaceId, reload };
}
