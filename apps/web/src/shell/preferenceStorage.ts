import type { StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { getTransport } from "../transport";

export interface PreferenceStorage {
	read(key: string): string | null;
	write(key: string, value: string): void;
}

export function preferenceStorage(stable: StablePreferenceAdapter | null): PreferenceStorage {
	if (stable) {
		return {
			read: (key) => stable.getItem(key),
			write: (key, value) => stable.setItem(key, value),
		};
	}
	const httpBase = getTransport().httpBase();
	return {
		read: (key) => window.localStorage.getItem(`${STORAGE_PREFIX}${key}:${httpBase}`),
		write: (key, value) =>
			window.localStorage.setItem(`${STORAGE_PREFIX}${key}:${httpBase}`, value),
	};
}

export function readPreference(storage: PreferenceStorage, key: string): string | null {
	try {
		return storage.read(key);
	} catch {
		return null;
	}
}

export function writePreference(storage: PreferenceStorage, key: string, value: string): void {
	try {
		storage.write(key, value);
	} catch {}
}
