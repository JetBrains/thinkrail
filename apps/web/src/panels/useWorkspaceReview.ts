import { useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { useWorkspaceRead } from "./useWorkspaceRead";

export function useWorkspaceReview(workspaceId: string | null): { failed: boolean } {
	const [failed, setFailed] = useState(false);
	useWorkspaceRead(workspaceId, (id) => getTransport().request("review.get", { workspaceId: id }), {
		onResult: (result, id) => {
			setFailed(false);
			useAppStore.getState().setWorkspaceReview(id, result);
		},
		onFailure: () => setFailed(true),
		onSwitch: () => setFailed(false),
	});
	return { failed };
}
