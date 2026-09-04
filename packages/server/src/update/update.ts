import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AvailableRelease,
	ReleaseChannel,
	UpdateCapabilities,
	UpdateInstallTarget,
	UpdateStatus,
} from "@thinkrail/contracts";
import { isReleaseChannel } from "@thinkrail/contracts";
import { logger } from "../log";
import { dataDir } from "../persistence";

const log = logger("update");

const BOOT_DELAY_MS = 30_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateProviderCapabilities = Omit<UpdateCapabilities, "restart">;

export type InstallOutcome =
	| { kind: "staged"; version: string; channel: ReleaseChannel }
	| { kind: "manual"; message: string; command?: string }
	| { kind: "failed"; message: string; retryable: boolean };

export interface UpdateProvider {
	readonly capabilities: UpdateProviderCapabilities;
	readonly current: { version: string; channel: ReleaseChannel | "dev"; commit?: string };
	check(signal: AbortSignal): Promise<AvailableRelease | null>;
	install(target: UpdateInstallTarget): Promise<InstallOutcome>;
	restart?(): Promise<never>;
}

export interface StartUpdatesOptions {
	provider?: UpdateProvider;
	appVersion?: string;
	checksEnabled?: boolean;
	bootDelayMs?: number;
	intervalMs?: number;
}

type UpdatePublisher = (status: UpdateStatus) => void;

interface StagedRelease {
	version: string;
	channel: ReleaseChannel;
}

interface UpdateRecord {
	dismissedVersion?: string | undefined;
	staged?: StagedRelease | undefined;
	lastCheckedAt?: number | undefined;
}

interface Internals {
	provider: UpdateProvider | null;
	appVersion: string;
	checksEnabled: boolean;
	activity: "idle" | "checking" | "installing";
	available?: AvailableRelease | undefined;
	record: UpdateRecord;
	error?: UpdateStatus["error"] | undefined;
	inFlight: Promise<UpdateStatus> | null;
	abort: AbortController | null;
	bootTimer: ReturnType<typeof setTimeout> | null;
	intervalTimer: ReturnType<typeof setInterval> | null;
	intervalMs: number;
	bootDelayMs: number;
}

const NO_PROVIDER: Internals = {
	provider: null,
	appVersion: "0.0.0-dev",
	checksEnabled: true,
	activity: "idle",
	record: {},
	inFlight: null,
	abort: null,
	bootTimer: null,
	intervalTimer: null,
	intervalMs: INTERVAL_MS,
	bootDelayMs: BOOT_DELAY_MS,
};

let state: Internals = { ...NO_PROVIDER };
let publisher: UpdatePublisher | null = null;

function recordFile(): string {
	return join(dataDir(), "update.json");
}

function parseRecord(value: unknown): UpdateRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const candidate = value as Record<string, unknown>;
	const record: UpdateRecord = {};
	if (typeof candidate.dismissedVersion === "string") {
		record.dismissedVersion = candidate.dismissedVersion;
	}
	if (typeof candidate.lastCheckedAt === "number" && Number.isFinite(candidate.lastCheckedAt)) {
		record.lastCheckedAt = candidate.lastCheckedAt;
	}
	const staged = candidate.staged as Record<string, unknown> | undefined;
	if (staged && typeof staged.version === "string" && isReleaseChannel(staged.channel)) {
		record.staged = { version: staged.version, channel: staged.channel };
	}
	return record;
}

function loadRecord(): UpdateRecord {
	try {
		return parseRecord(JSON.parse(readFileSync(recordFile(), "utf8")));
	} catch {
		return {};
	}
}

function saveRecord(record: UpdateRecord): void {
	const file = recordFile();
	const temporary = `${file}.${process.pid}.tmp`;
	try {
		mkdirSync(dataDir(), { recursive: true });
		writeFileSync(temporary, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
		renameSync(temporary, file);
	} catch (err) {
		try {
			rmSync(temporary, { force: true });
		} catch {}
		log.warn(`could not persist update state: ${err instanceof Error ? err.message : err}`);
	}
}

function capabilities(): UpdateCapabilities {
	const provider = state.provider;
	if (!provider) {
		return { install: false, restart: "manual", channelSwitch: "unsupported", channels: [] };
	}
	return { ...provider.capabilities, restart: provider.restart ? "self" : "manual" };
}

function snapshot(): UpdateStatus {
	const provider = state.provider;
	const current = provider?.current ?? { version: state.appVersion, channel: "dev" as const };
	const staged = state.record.staged;
	const phase: UpdateStatus["phase"] =
		state.activity !== "idle"
			? state.activity
			: staged
				? "staged"
				: state.error
					? "error"
					: state.available
						? "available"
						: "idle";
	return {
		current,
		capabilities: capabilities(),
		phase,
		...(state.available ? { available: state.available } : {}),
		...(staged ? { staged } : {}),
		...(state.record.lastCheckedAt ? { lastCheckedAt: state.record.lastCheckedAt } : {}),
		...(state.record.dismissedVersion ? { dismissedVersion: state.record.dismissedVersion } : {}),
		...(state.error ? { error: state.error } : {}),
	};
}

function publish(): UpdateStatus {
	const status = snapshot();
	publisher?.(status);
	return status;
}

function canCheck(): boolean {
	return state.provider?.capabilities.install === true && state.checksEnabled;
}

function clearTimers(): void {
	if (state.bootTimer) clearTimeout(state.bootTimer);
	if (state.intervalTimer) clearInterval(state.intervalTimer);
	state.bootTimer = null;
	state.intervalTimer = null;
}

function scheduleChecks(): void {
	clearTimers();
	if (!canCheck()) return;
	state.bootTimer = setTimeout(() => {
		void checkForUpdate().catch(() => {});
	}, state.bootDelayMs);
	state.bootTimer.unref?.();
	state.intervalTimer = setInterval(() => {
		void checkForUpdate().catch(() => {});
	}, state.intervalMs);
	state.intervalTimer.unref?.();
}

export function setUpdatePublisher(next: UpdatePublisher | null): void {
	publisher = next;
}

export function startUpdates(options: StartUpdatesOptions = {}): UpdateStatus {
	clearTimers();
	state = {
		...NO_PROVIDER,
		provider: options.provider ?? null,
		appVersion: options.appVersion ?? NO_PROVIDER.appVersion,
		checksEnabled: options.checksEnabled ?? true,
		record: loadRecord(),
		bootDelayMs: options.bootDelayMs ?? BOOT_DELAY_MS,
		intervalMs: options.intervalMs ?? INTERVAL_MS,
	};

	const staged = state.record.staged;
	const running = state.provider?.current.version;
	if (staged && running && staged.version === running) {
		state.record = { ...state.record, staged: undefined };
		saveRecord(state.record);
	}

	scheduleChecks();
	return publish();
}

export function stopUpdates(): void {
	clearTimers();
	state.abort?.abort();
	state.abort = null;
	state.inFlight = null;
	if (state.activity === "checking") state.activity = "idle";
}

export function getUpdateStatus(): UpdateStatus {
	return snapshot();
}

export function setUpdateChecksEnabled(enabled: boolean): void {
	if (state.checksEnabled === enabled) return;
	state.checksEnabled = enabled;
	if (enabled) {
		scheduleChecks();
		return;
	}
	clearTimers();
	state.abort?.abort();
}

export function checkForUpdate(): Promise<UpdateStatus> {
	if (state.inFlight) return state.inFlight;
	if (!canCheck()) return Promise.resolve(snapshot());
	const provider = state.provider as UpdateProvider;

	const abort = new AbortController();
	state.abort = abort;
	state.activity = "checking";
	publish();

	const run = (async (): Promise<UpdateStatus> => {
		try {
			const found = await provider.check(abort.signal);
			state.available = found ?? undefined;
			state.error = undefined;
			state.record = { ...state.record, lastCheckedAt: Date.now() };
			saveRecord(state.record);
		} catch (err) {
			if (!abort.signal.aborted) {
				state.error = {
					kind: "failed",
					message: err instanceof Error ? err.message : String(err),
					retryable: true,
				};
				log.debug(`release check failed: ${state.error.message}`);
			}
		} finally {
			state.activity = "idle";
			state.inFlight = null;
			state.abort = null;
		}
		return publish();
	})();

	state.inFlight = run;
	return run;
}

export async function installUpdate(target: UpdateInstallTarget): Promise<UpdateStatus> {
	const provider = state.provider;
	if (!provider?.capabilities.install) {
		throw new Error("this ThinkRail host cannot install updates");
	}
	if (state.activity === "installing") return snapshot();

	state.activity = "installing";
	state.error = undefined;
	publish();

	try {
		const outcome = await provider.install(target);
		if (outcome.kind === "staged") {
			state.record = {
				...state.record,
				staged: { version: outcome.version, channel: outcome.channel },
				dismissedVersion: undefined,
			};
			saveRecord(state.record);
			state.available = undefined;
		} else {
			state.error = {
				kind: outcome.kind === "manual" ? "manual" : "failed",
				message: outcome.message,
				retryable: outcome.kind === "failed" ? outcome.retryable : false,
				...(outcome.kind === "manual" && outcome.command ? { command: outcome.command } : {}),
			};
		}
	} catch (err) {
		state.error = {
			kind: "failed",
			message: err instanceof Error ? err.message : String(err),
			retryable: true,
		};
	} finally {
		state.activity = "idle";
	}
	return publish();
}

export function dismissUpdate(version: string): UpdateStatus {
	state.record = { ...state.record, dismissedVersion: version };
	saveRecord(state.record);
	return publish();
}

export function resetUpdateState(): void {
	clearTimers();
	state.abort?.abort();
	state = { ...NO_PROVIDER };
	publisher = null;
}
