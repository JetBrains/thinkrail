import type { BranchList } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTransport } from "../transport";

const NO_BRANCHES: BranchList = { local: [], remote: [], defaultBranch: "" };

async function listBranchesOrEmpty(projectId: string): Promise<BranchList> {
	try {
		return await getTransport().request("git.listBranches", { projectId });
	} catch {
		return NO_BRANCHES;
	}
}

export function useBranchList(
	projectId: string | null,
	onLoaded?: (list: BranchList) => void,
): { branches: BranchList | null; refreshing: boolean; refresh: () => void } {
	const [branches, setBranches] = useState<BranchList | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const latestOnLoaded = useRef(onLoaded);
	latestOnLoaded.current = onLoaded;
	const generation = useRef(0);

	useEffect(() => {
		const mine = ++generation.current;
		setBranches(null);
		setRefreshing(false);
		if (!projectId) return;
		void listBranchesOrEmpty(projectId).then((list) => {
			if (generation.current !== mine) return;
			setBranches(list);
			latestOnLoaded.current?.(list);
		});
		return () => {
			generation.current += 1;
		};
	}, [projectId]);

	const refresh = useCallback(() => {
		if (!projectId) return;
		const mine = ++generation.current;
		setRefreshing(true);
		getTransport()
			.request("git.listBranches", { projectId })
			.then((list) => {
				if (generation.current === mine) setBranches(list);
			})
			.catch(() => {})
			.finally(() => {
				if (generation.current === mine) setRefreshing(false);
			});
	}, [projectId]);

	return { branches, refreshing, refresh };
}
