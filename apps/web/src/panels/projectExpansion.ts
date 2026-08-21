import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

function storageKey(): string {
	return `${STORAGE_PREFIX}expanded-projects:${getTransport().httpBase()}`;
}

function readPersistedExpansion(): string[] {
	try {
		const raw = localStorage.getItem(storageKey());
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id): id is string => typeof id === "string");
	} catch {
		return [];
	}
}

function persistExpansion(expanded: Record<string, true>): void {
	try {
		localStorage.setItem(storageKey(), JSON.stringify(Object.keys(expanded)));
	} catch {}
}

export function initProjectExpansionPersistence(): void {
	useAppStore.getState().hydrateExpandedProjects(readPersistedExpansion());
	let previous = useAppStore.getState().expandedProjectIds;
	useAppStore.subscribe((state) => {
		if (state.expandedProjectIds === previous) return;
		previous = state.expandedProjectIds;
		persistExpansion(previous);
	});
}
