import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface InstallationRecord {
	id: string;
}

interface PersistedInstallationRecord extends InstallationRecord {
	appInstalled?: true;
}

function readInstallation(directory: string): Partial<PersistedInstallationRecord> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(directory, "installation.json"), "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function writeInstallation(directory: string, record: InstallationRecord): void {
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "installation.json"), `${JSON.stringify(record, null, "\t")}\n`);
}

export function ensureInstallationIn(directory: string): InstallationRecord {
	const raw = readInstallation(directory);
	if (typeof raw.id === "string" && raw.id.length > 0) return { id: raw.id };
	const record: InstallationRecord = { id: randomUUID() };
	writeInstallation(directory, record);
	return record;
}

export function claimAppInstalledIn(
	directory: string,
	replace: typeof renameSync = renameSync,
): boolean {
	const raw = readInstallation(directory);
	if (raw.appInstalled === true) return false;
	const { id } = ensureInstallationIn(directory);
	mkdirSync(directory, { recursive: true });
	const target = join(directory, "installation.json");
	const temp = join(directory, `.installation.json.${process.pid}.${randomUUID()}.tmp`);
	try {
		writeFileSync(
			temp,
			`${JSON.stringify({ id, appInstalled: true } satisfies PersistedInstallationRecord, null, "\t")}\n`,
			{ flag: "wx" },
		);
		replace(temp, target);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {}
		throw error;
	}
	return true;
}
