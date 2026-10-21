import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DESKTOP_DIALOG_KEYS, EN, type EnglishCatalog } from "@thinkrail/locales";

const MAX_DIALOG_LABEL_LENGTH = 200;

export function readLabels<K extends keyof EnglishCatalog & string>(
	keys: readonly K[],
	maxLength: number,
	raw: unknown,
): Readonly<Record<K, string>> {
	const source = typeof raw === "object" && raw !== null ? raw : {};
	return Object.fromEntries(
		keys.map((key) => {
			const value: unknown = Reflect.get(source, key);
			return [
				key,
				typeof value === "string" && value.trim() && value.length <= maxLength
					? value
					: (EN[key] ?? key),
			];
		}),
	) as Record<K, string>;
}

export type DesktopDialogLabels = Readonly<Record<(typeof DESKTOP_DIALOG_KEYS)[number], string>>;

export function readDialogLabels(raw: unknown): DesktopDialogLabels {
	return readLabels(DESKTOP_DIALOG_KEYS, MAX_DIALOG_LABEL_LENGTH, raw);
}

export const DEFAULT_DIALOG_LABELS: DesktopDialogLabels = readDialogLabels({});

export function readNativeLabels(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {};
	}
}

export function writeNativeLabels(path: string, labels: Readonly<Record<string, string>>): void {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(labels));
	} catch (error) {
		console.warn("[desktop] could not save the native labels", error);
	}
}
