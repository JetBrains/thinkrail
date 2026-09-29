import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	type AcquisitionRecord,
	hasExactKeys,
	isRecord,
	parseAcquisitionRecord,
} from "./attributionProtocol";

const FILE_NAME = "attribution.json";

const ATTEMPT_RECORD = { browserClaimAttempted: true } as const;
type AttemptRecord = typeof ATTEMPT_RECORD;

function replaceRecordIn(
	directory: string,
	record: AcquisitionRecord | AttemptRecord,
	replace: typeof renameSync = renameSync,
): void {
	mkdirSync(directory, { recursive: true });
	const target = join(directory, FILE_NAME);
	const temp = join(directory, `.attribution.json.${process.pid}.${randomUUID()}.tmp`);
	try {
		writeFileSync(temp, `${JSON.stringify(record, null, "\t")}\n`, { flag: "wx" });
		replace(temp, target);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {}
		throw error;
	}
}

export function replaceAcquisitionWithTerminalMarkerIn(
	directory: string,
	replace: typeof renameSync = renameSync,
): void {
	replaceRecordIn(directory, ATTEMPT_RECORD, replace);
}

export function readAcquisitionIn(
	directory: string,
	now = Date.now(),
): AcquisitionRecord | undefined {
	const target = join(directory, FILE_NAME);
	try {
		const value: unknown = JSON.parse(readFileSync(target, "utf8"));
		if (
			isRecord(value) &&
			hasExactKeys(value, ["browserClaimAttempted"]) &&
			value.browserClaimAttempted === true
		) {
			return undefined;
		}
		const record = parseAcquisitionRecord(value, now);
		if (record) return record;
	} catch {
		if (!existsSync(target)) return undefined;
	}
	try {
		replaceAcquisitionWithTerminalMarkerIn(directory);
	} catch {}
	return undefined;
}

export function claimBrowserAttributionAttemptIn(directory: string): boolean {
	mkdirSync(directory, { recursive: true });
	try {
		writeFileSync(join(directory, FILE_NAME), `${JSON.stringify(ATTEMPT_RECORD, null, "\t")}\n`, {
			flag: "wx",
		});
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}

export function saveAcquisitionIn(
	directory: string,
	record: AcquisitionRecord,
	replace: typeof renameSync = renameSync,
): void {
	replaceRecordIn(directory, record, replace);
}
