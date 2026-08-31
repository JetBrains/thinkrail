import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	isDesktopPreferenceKey,
	isDesktopPreferenceScopeId,
	isDesktopPreferenceValue,
} from "./preferenceAdapter";

const PREFERENCE_VERSION = 1;
const MAX_PREFERENCE_SCOPES = 32;
const MAX_PREFERENCES = 256;
const MAX_PREFERENCE_DOCUMENT_BYTES = 1024 * 1024;
const MAX_ENCODED_SCOPE_KEY_LENGTH = 4096;

interface PreferenceDocument {
	version: 1;
	preferences: Record<string, Record<string, string>>;
}

function emptyDocument(): PreferenceDocument {
	return { version: PREFERENCE_VERSION, preferences: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopeKey(backendProfileId: unknown, windowId: unknown): string | null {
	if (!isDesktopPreferenceScopeId(backendProfileId) || !isDesktopPreferenceScopeId(windowId)) {
		return null;
	}
	try {
		return `${encodeURIComponent(backendProfileId)}:${encodeURIComponent(windowId)}`;
	} catch {
		return null;
	}
}

function validPersistedScopeKey(value: string): boolean {
	if (value.length === 0 || value.length > MAX_ENCODED_SCOPE_KEY_LENGTH) return false;
	const separator = value.indexOf(":");
	if (separator <= 0 || separator !== value.lastIndexOf(":") || separator === value.length - 1) {
		return false;
	}
	try {
		return (
			scopeKey(
				decodeURIComponent(value.slice(0, separator)),
				decodeURIComponent(value.slice(separator + 1)),
			) === value
		);
	} catch {
		return false;
	}
}

function readDocument(path: string): PreferenceDocument {
	try {
		if (statSync(path).size > MAX_PREFERENCE_DOCUMENT_BYTES) return emptyDocument();
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(value) || Reflect.get(value, "version") !== PREFERENCE_VERSION) {
			return emptyDocument();
		}
		const storedDocumentPreferences = Reflect.get(value, "preferences");
		if (!isRecord(storedDocumentPreferences)) return emptyDocument();
		const preferenceEntries: Array<[string, Record<string, string>]> = [];
		let totalPreferences = 0;
		for (const [storedScopeKey, storedPreferences] of Object.entries(storedDocumentPreferences)) {
			if (
				preferenceEntries.length >= MAX_PREFERENCE_SCOPES ||
				totalPreferences >= MAX_PREFERENCES
			) {
				break;
			}
			if (!validPersistedScopeKey(storedScopeKey) || !isRecord(storedPreferences)) continue;
			const scopeEntries: Array<[string, string]> = [];
			for (const [key, preferenceValue] of Object.entries(storedPreferences)) {
				if (totalPreferences >= MAX_PREFERENCES) break;
				if (!isDesktopPreferenceKey(key) || !isDesktopPreferenceValue(preferenceValue)) continue;
				scopeEntries.push([key, preferenceValue]);
				totalPreferences += 1;
			}
			if (scopeEntries.length > 0) {
				preferenceEntries.push([storedScopeKey, Object.fromEntries(scopeEntries)]);
			}
		}
		return {
			version: PREFERENCE_VERSION,
			preferences: Object.fromEntries(preferenceEntries),
		};
	} catch {
		return emptyDocument();
	}
}

function cloneDocument(document: PreferenceDocument): PreferenceDocument {
	return {
		version: PREFERENCE_VERSION,
		preferences: Object.fromEntries(
			Object.entries(document.preferences).map(([key, preferences]) => [
				key,
				Object.fromEntries(Object.entries(preferences)),
			]),
		),
	};
}

function totalPreferenceCount(document: PreferenceDocument): number {
	return Object.values(document.preferences).reduce(
		(total, preferences) => total + Object.keys(preferences).length,
		0,
	);
}

function persistDocument(path: string, document: PreferenceDocument): boolean {
	const serialized = `${JSON.stringify(document, null, "\t")}\n`;
	if (Buffer.byteLength(serialized) > MAX_PREFERENCE_DOCUMENT_BYTES) return false;
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, serialized);
		return true;
	} catch {
		return false;
	}
}

export class PreferenceStore {
	readonly #path: string;
	#document: PreferenceDocument;

	constructor(path: string) {
		this.#path = path;
		this.#document = existsSync(path) ? readDocument(path) : emptyDocument();
	}

	read(backendProfileId: unknown, windowId: unknown): Record<string, string> {
		const key = scopeKey(backendProfileId, windowId);
		if (!key) return {};
		const preferences = this.#document.preferences[key];
		return preferences ? Object.fromEntries(Object.entries(preferences)) : {};
	}

	write(
		backendProfileId: unknown,
		windowId: unknown,
		preferenceKey: unknown,
		value: unknown,
	): boolean {
		const key = scopeKey(backendProfileId, windowId);
		if (!key || !isDesktopPreferenceKey(preferenceKey) || !isDesktopPreferenceValue(value)) {
			return false;
		}
		const existingScope = this.#document.preferences[key];
		if (existingScope && Object.hasOwn(existingScope, preferenceKey)) {
			if (existingScope[preferenceKey] === value) return true;
		} else {
			if (totalPreferenceCount(this.#document) >= MAX_PREFERENCES) return false;
			if (
				!existingScope &&
				Object.keys(this.#document.preferences).length >= MAX_PREFERENCE_SCOPES
			) {
				return false;
			}
		}
		const next = cloneDocument(this.#document);
		const nextScope = next.preferences[key] ?? {};
		Object.defineProperty(nextScope, preferenceKey, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		});
		next.preferences[key] = nextScope;
		if (!persistDocument(this.#path, next)) return false;
		this.#document = next;
		return true;
	}

	remove(backendProfileId: unknown, windowId: unknown, preferenceKey: unknown): boolean {
		const key = scopeKey(backendProfileId, windowId);
		if (!key || !isDesktopPreferenceKey(preferenceKey)) return false;
		const existingScope = this.#document.preferences[key];
		if (!existingScope || !Object.hasOwn(existingScope, preferenceKey)) return true;
		const next = cloneDocument(this.#document);
		const nextScope = next.preferences[key];
		if (!nextScope) return true;
		delete nextScope[preferenceKey];
		if (Object.keys(nextScope).length === 0) delete next.preferences[key];
		if (!persistDocument(this.#path, next)) return false;
		this.#document = next;
		return true;
	}
}
