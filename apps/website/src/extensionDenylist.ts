import { isPackageName } from "./extensionManifest";

export interface DenylistEntry {
	name: string;
	reason?: string;
	date?: string;
}

export type Denylist = ReadonlyMap<string, DenylistEntry>;

const entryKeys = new Set(["name", "reason", "date"]);
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDay(value: string): boolean {
	return isoDay.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

export function denylistErrors(value: unknown): string[] {
	if (!isRecord(value)) return ["the denylist is not an object"];
	const errors = Object.keys(value)
		.filter((key) => key !== "packages")
		.map((key) => `unknown field ${key}`);
	if (!Array.isArray(value.packages)) return [...errors, "packages must be an array"];
	const seen = new Set<string>();
	value.packages.forEach((entry: unknown, index) => {
		const at = `packages[${index}]`;
		if (!isRecord(entry)) {
			errors.push(`${at} is not an object`);
			return;
		}
		for (const key of Object.keys(entry)) {
			if (!entryKeys.has(key)) errors.push(`${at} has unknown field ${key}`);
		}
		if (!isPackageName(entry.name)) {
			errors.push(`${at}.name is not a package name`);
		} else if (seen.has(entry.name)) {
			errors.push(`${at}.name ${entry.name} is listed twice`);
		} else seen.add(entry.name);
		if (entry.reason !== undefined && (typeof entry.reason !== "string" || !entry.reason.trim())) {
			errors.push(`${at}.reason must be a non-empty string`);
		}
		if (entry.date !== undefined && (typeof entry.date !== "string" || !validDay(entry.date))) {
			errors.push(`${at}.date must be a YYYY-MM-DD date`);
		}
	});
	return errors;
}

export function parseDenylist(value: unknown): Denylist {
	const errors = denylistErrors(value);
	if (errors.length > 0) {
		throw new Error(
			`extension-denylist.json is invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
		);
	}
	const entries = (value as { packages: DenylistEntry[] }).packages;
	return new Map(entries.map((entry) => [entry.name, entry]));
}
