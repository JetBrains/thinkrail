import type { WikiPage, WikiStatus } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { getTransport } from "@/transport";

export function useWikiStatus(workspaceId: string): {
	status: WikiStatus | null;
	failed: boolean;
	reload: () => void;
} {
	const [status, setStatus] = useState<WikiStatus | null>(null);
	const [failed, setFailed] = useState(false);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		void tick;
		let live = true;
		getTransport()
			.request("wiki.status", { workspaceId })
			.then((next) => {
				if (!live) return;
				setStatus(next);
				setFailed(false);
			})
			.catch(() => {
				if (live) setFailed(true);
			});
		return () => {
			live = false;
		};
	}, [workspaceId, tick]);

	const reload = useCallback(() => setTick((value) => value + 1), []);
	return { status, failed, reload };
}

export function useWikiArticle(
	workspaceId: string,
	path: string | null,
	revision: number | undefined,
): { article: WikiPage | null; failed: boolean } {
	const [article, setArticle] = useState<WikiPage | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		void revision;
		if (path === null) {
			setArticle(null);
			setFailed(false);
			return;
		}
		let live = true;
		getTransport()
			.request("wiki.page", { workspaceId, path })
			.then((next) => {
				if (!live) return;
				setArticle(next);
				setFailed(false);
			})
			.catch(() => {
				if (live) setFailed(true);
			});
		return () => {
			live = false;
		};
	}, [workspaceId, path, revision]);

	return { article: article?.path === path ? article : null, failed };
}
