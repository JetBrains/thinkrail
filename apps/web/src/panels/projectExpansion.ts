import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

function storageKey(kind: "expanded-projects" | "collapsed-containers"): string {
	return `${STORAGE_PREFIX}${kind}:${getTransport().httpBase()}`;
}

function readPersistedIds(key: string): string[] {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id): id is string => typeof id === "string");
	} catch {
		return [];
	}
}

function persistIds(key: string, ids: Record<string, true>): void {
	try {
		localStorage.setItem(key, JSON.stringify(Object.keys(ids)));
	} catch {}
}

export function initProjectExpansionPersistence(): void {
	const store = useAppStore.getState();
	store.hydrateExpandedProjects(readPersistedIds(storageKey("expanded-projects")));
	store.hydrateCollapsedContainers(readPersistedIds(storageKey("collapsed-containers")));
	let previous = useAppStore.getState();
	useAppStore.subscribe((state) => {
		if (state.expandedProjectIds !== previous.expandedProjectIds)
			persistIds(storageKey("expanded-projects"), state.expandedProjectIds);
		if (state.collapsedContainerIds !== previous.collapsedContainerIds)
			persistIds(storageKey("collapsed-containers"), state.collapsedContainerIds);
		previous = state;
	});
}
