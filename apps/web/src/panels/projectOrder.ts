import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

export function parseProjectOrder(raw: string | null): string[] {
	try {
		const value: unknown = raw ? JSON.parse(raw) : null;
		return Array.isArray(value)
			? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))]
			: [];
	} catch {
		return [];
	}
}

export function initProjectOrderPersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	let storage: StablePreferenceAdapter;
	let key: string;
	try {
		storage = stablePreferences ?? localStorage;
		key = stablePreferences
			? "project-order"
			: `${STORAGE_PREFIX}project-order:${getTransport().httpBase()}`;
	} catch {
		return () => {};
	}
	let initial: string[] = [];
	try {
		initial = parseProjectOrder(storage.getItem(key));
	} catch {}
	useAppStore.getState().hydrateProjectOrder(initial);
	let previous = useAppStore.getState().projectOrder;
	return useAppStore.subscribe((state) => {
		if (state.projectOrder === previous) return;
		previous = state.projectOrder;
		try {
			storage.setItem(key, JSON.stringify(previous));
		} catch {}
	});
}
