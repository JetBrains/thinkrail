import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import type {
	NativeUpdateInstallResult,
	NativeUpdateLogEntry,
	NativeUpdateLogEvent,
} from "@thinkrail/contracts";

export const UPDATE_JOURNAL_FILE = "update-journal.json";
export const MAX_UPDATE_LOG_ENTRIES = 200;
const MAX_JOURNAL_BYTES = 256 * 1024;
const MAX_TEXT_LENGTH = 4096;

export type UpdateJournal =
	| {
			schemaVersion: 1;
			state: "pending";
			fromVersion: string;
			toVersion: string;
			startedAt: number;
			log: NativeUpdateLogEntry[];
	  }
	| { schemaVersion: 1; state: "resolved"; result: NativeUpdateInstallResult };

export interface UpdateJournalStore {
	read(): UpdateJournal | null;
	write(journal: UpdateJournal): void;
	clear(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown): string | null {
	return typeof value === "string" && value.length <= MAX_TEXT_LENGTH ? value : null;
}

function nullableText(value: unknown): string | null | undefined {
	if (value === null) return null;
	return boundedText(value) ?? undefined;
}

function readEvent(value: unknown): NativeUpdateLogEvent | null {
	if (!isRecord(value)) return null;
	switch (value.kind) {
		case "hostStopping":
		case "handoffStarted":
		case "restarting":
			return { kind: value.kind };
		case "hostStopped":
			return typeof value.seconds === "number" && Number.isFinite(value.seconds)
				? { kind: "hostStopped", seconds: value.seconds }
				: null;
		case "installStarted":
		case "installed": {
			const version = boundedText(value.version);
			return version ? { kind: value.kind, version } : null;
		}
		case "installFailed": {
			const version = boundedText(value.version);
			const step = boundedText(value.step);
			const detail = boundedText(value.detail);
			return version && step !== null && detail !== null
				? { kind: "installFailed", version, step, detail }
				: null;
		}
		case "diagnostic": {
			const text = boundedText(value.text);
			return text === null ? null : { kind: "diagnostic", text };
		}
		default:
			return null;
	}
}

function readLog(value: unknown): NativeUpdateLogEntry[] | null {
	if (!Array.isArray(value) || value.length > MAX_UPDATE_LOG_ENTRIES) return null;
	const entries: NativeUpdateLogEntry[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) return null;
		const event = readEvent(entry.event);
		const { at, source, level } = entry;
		if (
			event === null ||
			typeof at !== "number" ||
			!Number.isFinite(at) ||
			(source !== "update" && source !== "host" && source !== "installer") ||
			(level !== "info" && level !== "error")
		) {
			return null;
		}
		entries.push({ at, source, level, event });
	}
	return entries;
}

function readResult(value: unknown): NativeUpdateInstallResult | null {
	if (!isRecord(value)) return null;
	const { outcome } = value;
	const toVersion = boundedText(value.toVersion);
	const fromVersion = nullableText(value.fromVersion);
	const failedStep = nullableText(value.failedStep);
	const detail = nullableText(value.detail);
	const log = readLog(value.log);
	if (
		(outcome !== "installed" && outcome !== "failed" && outcome !== "unreported") ||
		!toVersion ||
		fromVersion === undefined ||
		failedStep === undefined ||
		detail === undefined ||
		log === null
	) {
		return null;
	}
	return { outcome, fromVersion, toVersion, failedStep, detail, log };
}

export function parseUpdateJournal(value: unknown): UpdateJournal | null {
	if (!isRecord(value) || value.schemaVersion !== 1) return null;
	if (value.state === "resolved") {
		const result = readResult(value.result);
		return result ? { schemaVersion: 1, state: "resolved", result } : null;
	}
	if (value.state !== "pending") return null;
	const fromVersion = boundedText(value.fromVersion);
	const toVersion = boundedText(value.toVersion);
	const log = readLog(value.log);
	const { startedAt } = value;
	if (
		!fromVersion ||
		!toVersion ||
		log === null ||
		typeof startedAt !== "number" ||
		!Number.isFinite(startedAt)
	) {
		return null;
	}
	return { schemaVersion: 1, state: "pending", fromVersion, toVersion, startedAt, log };
}

export function createUpdateJournalStore(
	path: string,
	reportError: (error: unknown) => void,
): UpdateJournalStore {
	const remove = (target: string): void => {
		try {
			rmSync(target, { force: true });
		} catch (error) {
			reportError(error);
		}
	};
	return {
		read: () => {
			try {
				const stat = statSync(path, { throwIfNoEntry: false });
				if (!stat?.isFile() || stat.size > MAX_JOURNAL_BYTES) return null;
				return parseUpdateJournal(JSON.parse(readFileSync(path, "utf8")));
			} catch (error) {
				reportError(error);
				return null;
			}
		},
		write: (journal) => {
			const partial = `${path}.partial`;
			try {
				writeFileSync(partial, JSON.stringify(journal));
				renameSync(partial, path);
			} catch (error) {
				reportError(error);
				remove(partial);
			}
		},
		clear: () => remove(path),
	};
}
