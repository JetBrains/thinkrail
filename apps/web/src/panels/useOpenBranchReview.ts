import type { OpenBranchReview, Workspace } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ConnectionStatus, getTransport } from "../transport";

type LoadedReview = { key: string; review: OpenBranchReview | null; url?: string };

export interface OpenBranchReviewState {
	review: OpenBranchReview | null;
	url?: string;
	noteOpenReview: (review: OpenBranchReview, url?: string) => void;
}

export function useOpenBranchReview(
	workspace: Workspace | null,
	status: ConnectionStatus,
): OpenBranchReviewState {
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
						if (requestToken.current !== token) return;
						setLoaded((prev) => {
							const url =
								review !== null &&
								prev?.key === key &&
								prev.review?.kind === review.kind &&
								prev.review.number === review.number
									? prev.url
									: undefined;
							return { key, review, ...(url ? { url } : {}) };
						});
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

	const noteOpenReview = useCallback(
		(review: OpenBranchReview, url?: string) => {
			if (key) setLoaded({ key, review, ...(url ? { url } : {}) });
		},
		[key],
	);

	const current = status === "connected" && loaded?.key === key ? loaded : null;
	return {
		review: current?.review ?? null,
		...(current?.url ? { url: current.url } : {}),
		noteOpenReview,
	};
}

export function openReviewLabel(review: OpenBranchReview): string {
	return review.kind === "pull-request" ? `PR #${review.number}` : `MR !${review.number}`;
}
