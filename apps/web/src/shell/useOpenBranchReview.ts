import type { OpenBranchReview, Workspace } from "@thinkrail/contracts";
import { useEffect, useRef, useState } from "react";
import { type ConnectionStatus, getTransport } from "../transport";

type LoadedReview = { key: string; review: OpenBranchReview | null };

export function useOpenBranchReview(
	workspace: Workspace | null,
	status: ConnectionStatus,
): OpenBranchReview | null {
	const workspaceId = workspace?.id ?? null;
	const key = workspace ? `${workspace.id}\0${workspace.branch}` : null;
	const [loaded, setLoaded] = useState<LoadedReview | null>(null);
	const requestToken = useRef(0);

	useEffect(() => {
		requestToken.current += 1;
		if (!workspaceId || !key || status !== "connected") return;

		const load = () => {
			const token = ++requestToken.current;
			void getTransport()
				.request("workspace.openReview", { workspaceId })
				.then(
					(review) => {
						if (requestToken.current === token) setLoaded({ key, review });
					},
					() => {
						if (requestToken.current === token) setLoaded({ key, review: null });
					},
				);
		};

		load();
		window.addEventListener("focus", load);
		return () => {
			requestToken.current += 1;
			window.removeEventListener("focus", load);
		};
	}, [key, status, workspaceId]);

	return status === "connected" && loaded?.key === key ? loaded.review : null;
}

export function openReviewLabel(review: OpenBranchReview): string {
	return review.kind === "pull-request" ? `PR #${review.number}` : `MR !${review.number}`;
}
