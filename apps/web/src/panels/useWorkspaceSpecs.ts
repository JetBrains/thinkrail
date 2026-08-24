import { useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { useWorkspaceRead } from "./useWorkspaceRead";

export function useWorkspaceSpecs(workspaceId: string | null): {
	failed: boolean;
	reload: () => void;
} {
	const [failedFor, setFailedFor] = useState<string | null>(null);

	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("spec.graph", { workspaceId: id }),
		{
			onResult: (result, id) => {
				useAppStore.getState().setWorkspaceSpecs(id, result.nodes);
				setFailedFor(null);
			},
			onFailure: (id) => setFailedFor(id),
		},
	);

	return { failed: failedFor !== null && failedFor === workspaceId, reload };
}
