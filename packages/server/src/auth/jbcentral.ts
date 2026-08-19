import type {
	JbcentralAction,
	JbcentralActionFailureReason,
	JbcentralActionResult,
	JbcentralConnectResult,
	JbcentralLoginResult,
	JbcentralStatus,
} from "@thinkrail/contracts";
import {
	type JbcentralActionResult as CliActionResult,
	inspectJbcentral,
	JBCENTRAL_AUTH_TTL_MS,
	type JbcentralAuthVerdict,
	type JbcentralInspection,
	jbcentralExtensionPath,
	launchJbcentralLogin,
	probeJbcentralAuth,
	runJbcentralAction,
	watchJbcentralArtifact,
} from "@thinkrail/shared/jbcentral";
import {
	activatePiRuntimeGeneration,
	configurePiRuntimeSessionExtensionExclusions,
	preparePiRuntimeGeneration,
} from "../agent";

const REBUILD_DEBOUNCE_MS = 75;

/**
 * A status read never blocks on the auth probe: the cached verdict answers immediately, and the refresh it
 * kicks off publishes an invalidation only when the answer actually changed. A verdict therefore only
 * refreshes while someone is reading — nothing polls Central in the background.
 */
const AUTH_TTL_MS = JBCENTRAL_AUTH_TTL_MS;

type RebuildResult =
	| { outcome: "applied"; configured: boolean }
	| { outcome: "failed"; reason: "candidate-failed"; configured: boolean };

interface RebuildWaiter {
	sequence: number;
	resolve: (result: RebuildResult) => void;
}

let appliedConfigured = false;
let authVerdict: JbcentralAuthVerdict = "unknown";
let authProbedAt = 0;
let authGeneration = 0;
let authTask: Promise<void> | null = null;
let loadFailure: Extract<JbcentralStatus, { state: "load-failed" }> | null = null;
let transientAction: JbcentralAction | null = null;
let bootstrapped = false;
let bootstrapTask: Promise<void> | null = null;
let stopArtifactWatcher: (() => void) | null = null;
let stopped = false;

let requestedSequence = 0;
let settledSequence = 0;
let latestRequestAction: JbcentralAction | undefined;
let rebuildDeadline = 0;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let rebuildTask: Promise<void> | null = null;
const rebuildWaiters: RebuildWaiter[] = [];

let actionTail = Promise.resolve();
const actionFlights = new Map<JbcentralAction, Promise<JbcentralActionResult>>();
let loginTask: Promise<JbcentralLoginResult> | null = null;
let publishApplied: () => void = () => {};
let publishChanged: () => void = () => {};

/** Host composition seam: analytics may observe only a successful in-app Connect. */
export function setJbcentralAppliedPublisher(publisher: () => void): void {
	publishApplied = publisher;
}

/** Host composition seam: broadcast a data-free provider/model invalidation. */
export function setJbcentralChangedPublisher(publisher: () => void): void {
	publishChanged = publisher;
}

function failed(reason: JbcentralActionFailureReason): JbcentralActionResult {
	return { outcome: "failed", reason };
}

function inspectionConfigured(inspection: JbcentralInspection): boolean {
	return inspection.status.state === "supported" && inspection.status.configured;
}

function mapInspectionStatus(inspection: JbcentralInspection): JbcentralStatus {
	switch (inspection.status.state) {
		case "absent":
			return { state: "absent" };
		case "outdated":
			return { state: "outdated", version: inspection.status.version };
		case "malformed-version":
			return { state: "malformed-version" };
		case "probe-failed":
			return { state: "probe-failed", reason: inspection.status.reason };
		case "supported": {
			// Only a verdict we positively observed becomes a sign-in demand.
			const signedOut = authVerdict === "signed-out";
			return inspection.status.configured
				? { state: "configured", version: inspection.status.version, signedOut }
				: { state: "supported", version: inspection.status.version, signedOut };
		}
	}
}

/**
 * Drop the cached verdict so the next status read re-probes — after anything that can change auth. Bumping
 * the generation is what makes this hold against a probe that is already running: that probe read the world
 * as it was *before* the change, so letting it land would cache a stale answer as fresh and swallow the
 * invalidation for a whole TTL — exactly the credential change this seam exists to notice.
 */
function invalidateAuth(): void {
	authProbedAt = 0;
	authGeneration += 1;
}

/**
 * Refresh the auth verdict off the read path, at most one probe in flight, and publish an invalidation only
 * when the answer changed — so an open card learns about a sign-in without any client polling.
 */
function refreshAuthIfStale(): void {
	if (stopped || authTask || Date.now() - authProbedAt < AUTH_TTL_MS) return;
	const generation = authGeneration;
	const task = (async () => {
		const verdict = await probeJbcentralAuth();
		if (stopped || generation !== authGeneration) return;
		authProbedAt = Date.now();
		if (verdict === authVerdict) return;
		authVerdict = verdict;
		publishChanged();
	})();
	authTask = task;
	void task
		.catch(() => {})
		.finally(() => {
			if (authTask === task) authTask = null;
		});
}

function inspectionFailure(inspection: JbcentralInspection): JbcentralActionResult | null {
	switch (inspection.status.state) {
		case "absent":
			return failed("not-installed");
		case "outdated":
		case "malformed-version":
			return failed("unsupported-version");
		case "probe-failed":
			return failed("version-probe-failed");
		case "supported":
			return null;
	}
}

function mapCliFailure(result: CliActionResult): JbcentralActionFailureReason | null {
	if (result.outcome === "succeeded") return null;
	switch (result.reason) {
		case "not-installed":
			return "not-installed";
		case "artifact-missing":
			return "artifact-missing";
		case "artifact-present":
			return "artifact-present";
		default:
			return "central-action-failed";
	}
}

function configuringStatus(): JbcentralStatus {
	const action = transientAction ?? latestRequestAction;
	return { state: "configuring", ...(action ? { action } : {}) };
}

function settleRebuildWaiters(sequence: number, result: RebuildResult): void {
	for (let index = rebuildWaiters.length - 1; index >= 0; index -= 1) {
		const waiter = rebuildWaiters[index];
		if (!waiter || waiter.sequence > sequence) continue;
		rebuildWaiters.splice(index, 1);
		waiter.resolve(result);
	}
}

function waitForRebuild(sequence: number): Promise<RebuildResult> {
	return new Promise((resolve) => rebuildWaiters.push({ sequence, resolve }));
}

function scheduleRebuildDrain(): void {
	if (stopped || !bootstrapped || rebuildTask || rebuildTimer) return;
	const delay = Math.max(0, rebuildDeadline - Date.now());
	rebuildTimer = setTimeout(() => {
		rebuildTimer = null;
		startRebuildDrain();
	}, delay);
}

async function runRebuildDrain(): Promise<void> {
	while (!stopped && settledSequence < requestedSequence) {
		const delay = rebuildDeadline - Date.now();
		if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
		if (stopped) return;

		const sequence = requestedSequence;
		const action = latestRequestAction;
		const inspection = await inspectJbcentral();
		const configured = inspectionConfigured(inspection);
		const prepared = await preparePiRuntimeGeneration(configured ? [inspection.extensionPath] : []);

		// Stale candidate: a newer observation owns the pointer.
		if (stopped) return;
		if (sequence !== requestedSequence) continue;

		settledSequence = sequence;
		if (prepared.outcome === "prepared") {
			activatePiRuntimeGeneration(prepared.generation);
			appliedConfigured = configured;
			loadFailure = null;
			latestRequestAction = undefined;
			settleRebuildWaiters(sequence, { outcome: "applied", configured });
		} else {
			loadFailure = {
				state: "load-failed",
				configured,
				reason: "candidate-failed",
				...(action ? { action } : {}),
			};
			settleRebuildWaiters(sequence, {
				outcome: "failed",
				reason: "candidate-failed",
				configured,
			});
		}
		publishChanged();
	}
}

function startRebuildDrain(): void {
	if (stopped || !bootstrapped || rebuildTask) return;
	const task = runRebuildDrain();
	rebuildTask = task;
	void task.finally(() => {
		if (rebuildTask === task) rebuildTask = null;
		if (!stopped && settledSequence < requestedSequence) scheduleRebuildDrain();
	});
}

function requestRuntimeRebuild(action?: JbcentralAction): Promise<RebuildResult> {
	if (stopped) {
		return Promise.resolve({
			outcome: "failed",
			reason: "candidate-failed",
			configured: appliedConfigured,
		});
	}
	const sequence = ++requestedSequence;
	latestRequestAction = action;
	loadFailure = null;
	rebuildDeadline = Date.now() + REBUILD_DEBOUNCE_MS;
	if (rebuildTimer) {
		clearTimeout(rebuildTimer);
		rebuildTimer = null;
	}
	publishChanged();
	scheduleRebuildDrain();
	return waitForRebuild(sequence);
}

async function prepareInitialRuntime(inspection: JbcentralInspection): Promise<void> {
	const configured = inspectionConfigured(inspection);
	const prepared = await preparePiRuntimeGeneration(configured ? [inspection.extensionPath] : []);
	if (prepared.outcome === "prepared") {
		activatePiRuntimeGeneration(prepared.generation);
		appliedConfigured = configured;
		return;
	}
	if (!configured) throw new Error("PI runtime initialization failed");

	const plain = await preparePiRuntimeGeneration([]);
	if (plain.outcome !== "prepared") throw new Error("PI runtime initialization failed");
	activatePiRuntimeGeneration(plain.generation);
	appliedConfigured = false;
	loadFailure = {
		state: "load-failed",
		configured: true,
		action: "connect",
		reason: "candidate-failed",
	};
}

/** Initialize watching plus the current PI generation before any chat/runtime read. */
export function initializeJbcentralRuntime(): Promise<void> {
	if (bootstrapTask) return bootstrapTask;
	stopped = false;
	bootstrapTask = (async () => {
		const extensionPath = jbcentralExtensionPath();
		configurePiRuntimeSessionExtensionExclusions([extensionPath]);
		stopArtifactWatcher = watchJbcentralArtifact(() => {
			void requestRuntimeRebuild();
		});

		const inspection = await inspectJbcentral();
		await prepareInitialRuntime(inspection);
		bootstrapped = true;

		if (settledSequence < requestedSequence) {
			scheduleRebuildDrain();
			await waitForRebuild(requestedSequence);
		}
	})();
	return bootstrapTask;
}

/** Stop future watcher/rebuild work. A candidate already loading is discarded when it returns. */
export function stopJbcentralRuntime(): void {
	stopped = true;
	stopArtifactWatcher?.();
	stopArtifactWatcher = null;
	if (rebuildTimer) clearTimeout(rebuildTimer);
	rebuildTimer = null;
	const result: RebuildResult = {
		outcome: "failed",
		reason: "candidate-failed",
		configured: appliedConfigured,
	};
	settleRebuildWaiters(Number.POSITIVE_INFINITY, result);
}

/** Closed status projection with a pull-side repair if a filesystem event was missed. */
export async function getJbcentralStatus(): Promise<JbcentralStatus> {
	await initializeJbcentralRuntime();
	if (transientAction || settledSequence < requestedSequence) return configuringStatus();

	const inspection = await inspectJbcentral();
	const configured = inspectionConfigured(inspection);
	if (loadFailure) {
		// Keep the closed failure only while it describes the latest artifact state.
		if (configured === loadFailure.configured) return loadFailure;
		void requestRuntimeRebuild();
		return configuringStatus();
	}
	if (configured !== appliedConfigured) {
		void requestRuntimeRebuild();
		return configuringStatus();
	}
	// Only meaningful once Central is usable at all, and only from the settled path — never mid-action.
	if (inspection.status.state === "supported") refreshAuthIfStale();
	return mapInspectionStatus(inspection);
}

async function connect(): Promise<JbcentralActionResult> {
	transientAction = "connect";
	publishChanged();
	try {
		const inspection = await inspectJbcentral();
		const preflightFailure = inspectionFailure(inspection);
		if (preflightFailure) return preflightFailure;
		const actionFailure = mapCliFailure(await runJbcentralAction("add"));
		if (actionFailure) {
			// A refused `add pi` is itself evidence about auth — re-probe rather than serve the old verdict.
			invalidateAuth();
			return failed(actionFailure);
		}
		const rebuilt = await requestRuntimeRebuild("connect");
		if (rebuilt.outcome === "failed") return failed(rebuilt.reason);
		publishApplied();
		return { outcome: "applied" };
	} finally {
		transientAction = null;
		publishChanged();
	}
}

async function disconnect(): Promise<JbcentralActionResult> {
	transientAction = "disconnect";
	publishChanged();
	try {
		const inspection = await inspectJbcentral();
		// An already-absent artifact is the complete postcondition; rebuild plain PI directly.
		if (inspection.artifactExists) {
			const preflightFailure = inspectionFailure(inspection);
			if (preflightFailure) return preflightFailure;
			const actionFailure = mapCliFailure(await runJbcentralAction("remove"));
			if (actionFailure) return failed(actionFailure);
		}
		const rebuilt = await requestRuntimeRebuild("disconnect");
		return rebuilt.outcome === "applied" ? { outcome: "applied" } : failed(rebuilt.reason);
	} finally {
		transientAction = null;
		publishChanged();
	}
}

async function update(): Promise<JbcentralActionResult> {
	transientAction = "update";
	publishChanged();
	try {
		const before = await inspectJbcentral();
		if (before.status.state === "supported") return { outcome: "applied" };
		if (before.status.state !== "outdated") {
			return inspectionFailure(before) ?? failed("unsupported-version");
		}

		const updateFailure = mapCliFailure(await runJbcentralAction("update"));
		if (updateFailure) return failed(updateFailure);
		const afterUpdate = await inspectJbcentral();
		const postflightFailure = inspectionFailure(afterUpdate);
		if (postflightFailure) return postflightFailure;

		if (before.artifactExists) {
			const addFailure = mapCliFailure(await runJbcentralAction("add"));
			if (addFailure) return failed(addFailure);
		}
		const rebuilt = await requestRuntimeRebuild("update");
		return rebuilt.outcome === "applied" ? { outcome: "applied" } : failed(rebuilt.reason);
	} finally {
		transientAction = null;
		publishChanged();
	}
}

function scheduleAction(
	action: JbcentralAction,
	operation: () => Promise<JbcentralActionResult>,
): Promise<JbcentralActionResult> {
	const existing = actionFlights.get(action);
	if (existing) return existing;

	const task = actionTail
		.then(operation)
		.catch((): JbcentralActionResult => failed("central-action-failed"));
	actionFlights.set(action, task);
	actionTail = task.then(() => undefined);
	void task.finally(() => {
		if (actionFlights.get(action) === task) actionFlights.delete(action);
	});
	return task;
}

export function connectJbcentral(): Promise<JbcentralConnectResult> {
	return scheduleAction("connect", connect);
}

export function disconnectJbcentral(): Promise<JbcentralActionResult> {
	return scheduleAction("disconnect", disconnect);
}

export function updateJbcentral(): Promise<JbcentralActionResult> {
	return scheduleAction("update", update);
}

export function jbcentralLogin(): Promise<JbcentralLoginResult> {
	if (loginTask) return loginTask;
	const task = actionTail
		.then(async (): Promise<JbcentralLoginResult> => {
			const inspection = await inspectJbcentral();
			switch (inspection.status.state) {
				case "absent":
					return { outcome: "failed", reason: "not-installed" };
				case "outdated":
				case "malformed-version":
					return { outcome: "failed", reason: "unsupported-version" };
				case "probe-failed":
					return { outcome: "failed", reason: "version-probe-failed" };
				case "supported":
					// The user is about to sign in out-of-band; the current verdict is already obsolete.
					invalidateAuth();
					return await launchJbcentralLogin();
			}
		})
		.catch((): JbcentralLoginResult => ({ outcome: "failed", reason: "launch-failed" }));
	loginTask = task;
	actionTail = task.then(() => undefined);
	void task.finally(() => {
		if (loginTask === task) loginTask = null;
	});
	return task;
}

export async function resetJbcentralStateForTests(): Promise<void> {
	stopJbcentralRuntime();
	await Promise.allSettled([actionTail, rebuildTask, authTask]);
	appliedConfigured = false;
	authVerdict = "unknown";
	authProbedAt = 0;
	authGeneration = 0;
	authTask = null;
	loadFailure = null;
	transientAction = null;
	bootstrapped = false;
	bootstrapTask = null;
	stopped = false;
	requestedSequence = 0;
	settledSequence = 0;
	latestRequestAction = undefined;
	rebuildDeadline = 0;
	rebuildTask = null;
	rebuildWaiters.splice(0);
	actionTail = Promise.resolve();
	actionFlights.clear();
	loginTask = null;
	publishApplied = () => {};
	publishChanged = () => {};
}
