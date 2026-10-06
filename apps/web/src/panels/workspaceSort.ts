import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore, type WorkspaceSort } from "../store";
import { getTransport } from "../transport";

const SORTS: readonly WorkspaceSort[] = ["recent", "created", "name"];

function storageKey(): string {
	return `${STORAGE_PREFIX}workspace-sort:${getTransport().httpBase()}`;
}

function readPersistedSort(): WorkspaceSort | null {
	try {
		const raw = localStorage.getItem(storageKey());
		return SORTS.find((sort) => sort === raw) ?? null;
	} catch {
		return null;
	}
}

export function initWorkspaceSortPersistence(): void {
	const persisted = readPersistedSort();
	if (persisted) useAppStore.getState().setWorkspaceSort(persisted);
	let previous = useAppStore.getState().workspaceSort;
	useAppStore.subscribe((state) => {
		if (state.workspaceSort === previous) return;
		previous = state.workspaceSort;
		try {
			localStorage.setItem(storageKey(), previous);
		} catch {}
	});
}
