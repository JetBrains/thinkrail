import type { NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_CHECK_JITTER_RATIO = 0.1;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
const MAX_ERROR_LENGTH = 1024;
const SEMVER_PATTERN =
	/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

type CancelSchedule = () => void;
type StatePatch = Partial<
	Pick<NativeUpdateState, "status" | "availableVersion" | "progress" | "error">
>;

export interface NativeUpdaterInfo {
	version: string;
	updateAvailable: boolean;
	updateReady: boolean;
	error: string;
}

export interface NativeUpdaterStatusEntry {
	status: string;
	message: string;
	details?: {
		progress?: number;
		errorMessage?: string;
	};
}

export interface NativeUpdaterDependency {
	updateInfo(): NativeUpdaterInfo;
	onStatusChange(listener: ((entry: NativeUpdaterStatusEntry) => void) | null): void;
	checkForUpdate(): Promise<NativeUpdaterInfo>;
	downloadUpdate(): Promise<void>;
}

export interface NativeUpdateControllerDependencies {
	enabled: boolean;
	version: string;
	channel: string;
	updater: NativeUpdaterDependency;
	restartToUpdate(): Promise<void>;
	schedule?(delayMs: number, callback: () => void): CancelSchedule;
	random?(): number;
}

export interface NativeUpdateController extends NativeUpdateBridge {
	start(): void;
	dispose(): void;
}

function errorText(value: unknown): string {
	const message = value instanceof Error ? value.message : String(value);
	return message.slice(0, MAX_ERROR_LENGTH) || "Native update failed";
}

export function isStrictlyNewerVersion(currentVersion: string, candidateVersion: string): boolean {
	if (!SEMVER_PATTERN.test(currentVersion) || !SEMVER_PATTERN.test(candidateVersion)) return false;
	return Bun.semver.order(currentVersion, candidateVersion) < 0;
}

function defaultSchedule(delayMs: number, callback: () => void): CancelSchedule {
	const timer = setTimeout(callback, delayMs);
	return () => clearTimeout(timer);
}

function progressFrom(entry: NativeUpdaterStatusEntry): number | null {
	const progress = entry.details?.progress;
	if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
	return Math.min(100, Math.max(0, progress));
}

export function createNativeUpdateController(
	dependencies: NativeUpdateControllerDependencies,
): NativeUpdateController {
	const schedule = dependencies.schedule ?? defaultSchedule;
	const random = dependencies.random ?? Math.random;
	const listeners = new Set<(state: NativeUpdateState) => void>();
	let state: Readonly<NativeUpdateState> = Object.freeze({
		revision: 0,
		status: dependencies.enabled ? "idle" : "disabled",
		version: dependencies.version,
		channel: dependencies.channel,
		availableVersion: null,
		progress: null,
		error: null,
	});
	let preparedVersion: string | null = null;
	let started = false;
	let disposed = false;
	let retryIndex = 0;
	let cancelScheduled: CancelSchedule | undefined;
	let checkOperation: Promise<boolean> | undefined;
	let restarting = false;

	const publish = (patch: StatePatch): void => {
		if (disposed) return;
		const next = { ...state, ...patch };
		if (
			state.status === next.status &&
			state.availableVersion === next.availableVersion &&
			state.progress === next.progress &&
			state.error === next.error
		) {
			return;
		}
		state = Object.freeze({ ...next, revision: state.revision + 1 });
		for (const listener of listeners) {
			try {
				listener(state);
			} catch (error) {
				console.error("[desktop] native update listener failed", error);
			}
		}
	};

	const setReady = (version: string): void => {
		preparedVersion = version;
		publish({
			status: "ready",
			availableVersion: version,
			progress: 100,
			error: null,
		});
	};

	const fail = (error: unknown): void => {
		const message = errorText(error);
		if (preparedVersion && state.status !== "installing") {
			publish({
				status: "ready",
				availableVersion: preparedVersion,
				progress: 100,
				error: message,
			});
			return;
		}
		publish({ status: "error", progress: null, error: message });
	};

	const isNewer = (info: NativeUpdaterInfo): boolean =>
		info.updateAvailable && isStrictlyNewerVersion(state.version, info.version);

	const acceptCheckedInfo = async (info: NativeUpdaterInfo): Promise<boolean> => {
		if (info.error) {
			fail(info.error);
			return false;
		}
		if (!isNewer(info)) {
			preparedVersion = null;
			publish({
				status: "idle",
				availableVersion: null,
				progress: null,
				error: null,
			});
			return true;
		}
		if (info.updateReady) {
			setReady(info.version);
			return true;
		}

		preparedVersion = null;
		publish({
			status: "downloading",
			availableVersion: info.version,
			progress: null,
			error: null,
		});
		try {
			await dependencies.updater.downloadUpdate();
			const downloaded = dependencies.updater.updateInfo();
			if (downloaded.error) {
				fail(downloaded.error);
				return false;
			}
			if (downloaded.updateReady && downloaded.version === info.version && isNewer(downloaded)) {
				setReady(downloaded.version);
				return true;
			}
			fail("Native update download did not complete");
			return false;
		} catch (error) {
			fail(error);
			return false;
		}
	};

	const readCheckedInfo = async (
		availableVersion = preparedVersion,
	): Promise<NativeUpdaterInfo | null> => {
		publish({
			status: "checking",
			availableVersion,
			progress: availableVersion ? 100 : null,
			error: null,
		});
		try {
			const info = await dependencies.updater.checkForUpdate();
			if (!info.error) return info;
			fail(info.error);
		} catch (error) {
			fail(error);
		}
		return null;
	};

	const checkAndDownload = async (): Promise<boolean> => {
		const info = await readCheckedInfo();
		return info ? acceptCheckedInfo(info) : false;
	};

	const clearScheduled = (): void => {
		cancelScheduled?.();
		cancelScheduled = undefined;
	};

	const scheduleCheck = (delayMs: number): void => {
		if (!started || disposed) return;
		clearScheduled();
		cancelScheduled = schedule(delayMs, () => {
			cancelScheduled = undefined;
			launchCheck();
		});
	};

	const scheduleAfterCheck = (succeeded: boolean): void => {
		if (!started || disposed || state.status === "installing") return;
		const retryDelay = succeeded ? undefined : RETRY_DELAYS_MS[retryIndex];
		if (retryDelay !== undefined) {
			retryIndex += 1;
			scheduleCheck(retryDelay);
			return;
		}
		retryIndex = 0;
		const unit = Math.min(1, Math.max(0, random()));
		const jitter = (unit * 2 - 1) * AUTO_CHECK_INTERVAL_MS * AUTO_CHECK_JITTER_RATIO;
		scheduleCheck(Math.round(AUTO_CHECK_INTERVAL_MS + jitter));
	};

	function launchCheck(): void {
		if (!dependencies.enabled || disposed || checkOperation || restarting) return;
		const operation = checkAndDownload();
		checkOperation = operation;
		void operation.then((succeeded) => {
			checkOperation = undefined;
			scheduleAfterCheck(succeeded);
		});
	}

	const handleStatus = (entry: NativeUpdaterStatusEntry): void => {
		if (!dependencies.enabled || disposed) return;
		if (entry.status === "download-progress") {
			publish({ status: "downloading", progress: progressFrom(entry), error: null });
			return;
		}
		if (entry.status === "download-complete") {
			const info = dependencies.updater.updateInfo();
			if (info.updateReady && isNewer(info)) setReady(info.version);
			return;
		}
		if (entry.status === "error") {
			fail(dependencies.updater.updateInfo().error || entry.details?.errorMessage || entry.message);
			return;
		}
		if (entry.status === "complete" && state.status !== "installing") {
			preparedVersion = null;
			publish({ status: "idle", availableVersion: null, progress: null, error: null });
		}
	};

	if (dependencies.enabled) dependencies.updater.onStatusChange(handleStatus);

	return {
		getState: async () => ({ ...state }),
		checkForUpdates: async () => {
			if (!dependencies.enabled || disposed) return;
			clearScheduled();
			retryIndex = 0;
			launchCheck();
		},
		restartToUpdate: async () => {
			if (!dependencies.enabled || disposed || restarting || !preparedVersion) return;
			clearScheduled();
			restarting = true;
			const expectedVersion = preparedVersion;
			const operation = (async () => {
				if (checkOperation) await checkOperation;
				const info = await readCheckedInfo(expectedVersion);
				if (!info) return;
				if (info.version !== expectedVersion || !info.updateReady || !isNewer(info)) {
					await acceptCheckedInfo(info);
					return;
				}
				publish({ status: "installing", progress: null, error: null });
				try {
					await dependencies.restartToUpdate();
				} catch (error) {
					fail(error);
				}
			})();
			void operation.then(() => {
				restarting = false;
				if (state.status !== "installing") scheduleAfterCheck(state.status === "ready");
			});
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		start: () => {
			if (!dependencies.enabled || started || disposed) return;
			started = true;
			scheduleCheck(0);
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			clearScheduled();
			listeners.clear();
			if (dependencies.enabled) dependencies.updater.onStatusChange(null);
		},
	};
}
