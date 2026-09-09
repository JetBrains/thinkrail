import type { NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_CHECK_JITTER_RATIO = 0.1;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
const MAX_ERROR_LENGTH = 1024;
const SEMVER_PATTERN =
	/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

type CancelSchedule = () => void;

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

function boundedError(value: unknown): string {
	const message = value instanceof Error ? value.message : String(value);
	return message.slice(0, MAX_ERROR_LENGTH) || "Native update failed";
}

function validVersion(value: string): boolean {
	return SEMVER_PATTERN.test(value);
}

export function isStrictlyNewerVersion(currentVersion: string, candidateVersion: string): boolean {
	if (!validVersion(currentVersion) || !validVersion(candidateVersion)) return false;
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

function stateChanged(
	current: NativeUpdateState,
	next: Omit<NativeUpdateState, "revision">,
): boolean {
	return (
		current.status !== next.status ||
		current.version !== next.version ||
		current.channel !== next.channel ||
		current.availableVersion !== next.availableVersion ||
		current.progress !== next.progress ||
		current.error !== next.error
	);
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
	let readyVersion: string | null = null;
	let started = false;
	let disposed = false;
	let retryIndex = 0;
	let cancelScheduled: CancelSchedule | undefined;
	let checkInFlight: Promise<boolean> | undefined;
	let restartInFlight: Promise<void> | undefined;

	const publish = (patch: Partial<Omit<NativeUpdateState, "revision">>): void => {
		const next = {
			status: patch.status ?? state.status,
			version: patch.version ?? state.version,
			channel: patch.channel ?? state.channel,
			availableVersion:
				patch.availableVersion === undefined ? state.availableVersion : patch.availableVersion,
			progress: patch.progress === undefined ? state.progress : patch.progress,
			error: patch.error === undefined ? state.error : patch.error,
		};
		if (!stateChanged(state, next)) return;
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
		readyVersion = version;
		publish({
			status: "ready",
			availableVersion: version,
			progress: 100,
			error: null,
		});
	};

	const publishFailure = (error: unknown): void => {
		const message = boundedError(error);
		if (readyVersion && state.status !== "installing") {
			publish({
				status: "ready",
				availableVersion: readyVersion,
				progress: 100,
				error: message,
			});
			return;
		}
		publish({ status: "error", progress: null, error: message });
	};

	const infoIsNewer = (info: NativeUpdaterInfo): boolean =>
		info.updateAvailable && isStrictlyNewerVersion(state.version, info.version);

	const finishCheckedInfo = async (info: NativeUpdaterInfo): Promise<boolean> => {
		if (info.error) {
			publishFailure(info.error);
			return false;
		}
		if (!infoIsNewer(info)) {
			readyVersion = null;
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

		readyVersion = null;
		publish({
			status: "downloading",
			availableVersion: info.version,
			progress: null,
			error: null,
		});
		try {
			await dependencies.updater.downloadUpdate();
		} catch (error) {
			publishFailure(error);
			return false;
		}
		const downloaded = dependencies.updater.updateInfo();
		if (downloaded.error) {
			publishFailure(downloaded.error);
			return false;
		}
		if (downloaded.updateReady && downloaded.version === info.version && infoIsNewer(downloaded)) {
			setReady(downloaded.version);
			return true;
		}
		publishFailure("Native update download did not complete");
		return false;
	};

	const runCheck = async (): Promise<boolean> => {
		publish({
			status: "checking",
			availableVersion: readyVersion,
			progress: readyVersion ? 100 : null,
			error: null,
		});
		let info: NativeUpdaterInfo;
		try {
			info = await dependencies.updater.checkForUpdate();
		} catch (error) {
			publishFailure(error);
			return false;
		}
		return finishCheckedInfo(info);
	};

	const periodicDelay = (): number => {
		const unit = Math.min(1, Math.max(0, random()));
		const jitter = (unit * 2 - 1) * AUTO_CHECK_INTERVAL_MS * AUTO_CHECK_JITTER_RATIO;
		return Math.round(AUTO_CHECK_INTERVAL_MS + jitter);
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
		if (succeeded) {
			retryIndex = 0;
			scheduleCheck(periodicDelay());
			return;
		}
		const retryDelay = RETRY_DELAYS_MS[retryIndex];
		if (retryDelay !== undefined) {
			retryIndex += 1;
			scheduleCheck(retryDelay);
			return;
		}
		retryIndex = 0;
		scheduleCheck(periodicDelay());
	};

	function launchCheck(): void {
		if (!dependencies.enabled || disposed || checkInFlight || restartInFlight) return;
		const operation = runCheck();
		checkInFlight = operation;
		void operation.then(
			(succeeded) => {
				if (checkInFlight !== operation) return;
				checkInFlight = undefined;
				scheduleAfterCheck(succeeded);
			},
			(error) => {
				if (checkInFlight !== operation) return;
				checkInFlight = undefined;
				publishFailure(error);
				scheduleAfterCheck(false);
			},
		);
	}

	const handleUpdaterStatus = (entry: NativeUpdaterStatusEntry): void => {
		if (!dependencies.enabled || disposed) return;
		const info = dependencies.updater.updateInfo();
		if (entry.status === "checking") {
			publish({ status: "checking", error: null });
			return;
		}
		if (
			entry.status === "download-starting" ||
			entry.status === "checking-local-tar" ||
			entry.status === "local-tar-found" ||
			entry.status === "local-tar-missing" ||
			entry.status === "fetching-patch" ||
			entry.status === "patch-found" ||
			entry.status === "patch-not-found" ||
			entry.status === "downloading-patch" ||
			entry.status === "applying-patch" ||
			entry.status === "patch-applied" ||
			entry.status === "patch-failed" ||
			entry.status === "extracting-version" ||
			entry.status === "patch-chain-complete" ||
			entry.status === "downloading-full-bundle" ||
			entry.status === "decompressing"
		) {
			publish({
				status: "downloading",
				availableVersion: infoIsNewer(info) ? info.version : state.availableVersion,
				error: null,
			});
			return;
		}
		if (entry.status === "download-progress") {
			publish({ status: "downloading", progress: progressFrom(entry), error: null });
			return;
		}
		if (entry.status === "download-complete") {
			if (info.updateReady && infoIsNewer(info)) setReady(info.version);
			return;
		}
		if (
			entry.status === "applying" ||
			entry.status === "extracting" ||
			entry.status === "replacing-app" ||
			entry.status === "launching-new-version"
		) {
			publish({ status: "installing", progress: null, error: null });
			return;
		}
		if (entry.status === "error") {
			publishFailure(info.error || entry.details?.errorMessage || entry.message);
			return;
		}
		if (entry.status === "complete" && state.status !== "installing") {
			readyVersion = null;
			publish({
				status: "idle",
				availableVersion: null,
				progress: null,
				error: null,
			});
		}
	};

	if (dependencies.enabled) dependencies.updater.onStatusChange(handleUpdaterStatus);

	return {
		getState: async () => ({ ...state }),
		checkForUpdates: async () => {
			if (!dependencies.enabled || disposed) return;
			clearScheduled();
			retryIndex = 0;
			launchCheck();
		},
		restartToUpdate: async () => {
			if (!dependencies.enabled || disposed || restartInFlight || !readyVersion) {
				return;
			}
			clearScheduled();
			const expectedVersion = readyVersion;
			const operation = (async () => {
				if (checkInFlight) await checkInFlight;
				publish({
					status: "checking",
					availableVersion: expectedVersion,
					progress: 100,
					error: null,
				});
				let info: NativeUpdaterInfo;
				try {
					info = await dependencies.updater.checkForUpdate();
				} catch (error) {
					publishFailure(error);
					return;
				}
				if (info.error) {
					publishFailure(info.error);
					return;
				}
				if (info.version !== expectedVersion || !info.updateReady || !infoIsNewer(info)) {
					await finishCheckedInfo(info);
					return;
				}
				publish({ status: "installing", progress: null, error: null });
				try {
					await dependencies.restartToUpdate();
				} catch (error) {
					publishFailure(error);
				}
			})();
			restartInFlight = operation;
			void operation.then(
				() => {
					if (restartInFlight !== operation) return;
					restartInFlight = undefined;
					if (state.status !== "installing") scheduleAfterCheck(state.status === "ready");
				},
				(error) => {
					if (restartInFlight !== operation) return;
					restartInFlight = undefined;
					publishFailure(error);
					scheduleAfterCheck(false);
				},
			);
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
