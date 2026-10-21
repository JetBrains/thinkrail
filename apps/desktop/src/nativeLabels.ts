import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DESKTOP_DIALOG_KEYS, EN } from "@thinkrail/locales";

const MAX_DIALOG_LABEL_LENGTH = 200;

export type DesktopDialogLabels = Readonly<Record<(typeof DESKTOP_DIALOG_KEYS)[number], string>>;

export const DEFAULT_DIALOG_LABELS: DesktopDialogLabels = Object.fromEntries(
	DESKTOP_DIALOG_KEYS.map((key) => [key, EN[key] ?? key]),
) as DesktopDialogLabels;

export function readDialogLabels(raw: unknown): DesktopDialogLabels {
	const source = typeof raw === "object" && raw !== null ? raw : {};
	return Object.fromEntries(
		DESKTOP_DIALOG_KEYS.map((key) => {
			const value: unknown = Reflect.get(source, key);
			return [
				key,
				typeof value === "string" && value.trim() && value.length <= MAX_DIALOG_LABEL_LENGTH
					? value
					: DEFAULT_DIALOG_LABELS[key],
			];
		}),
	) as DesktopDialogLabels;
}

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
