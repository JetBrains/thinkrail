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
	JBCENTRAL_STATUS_TTL_MS,
	type JbcentralInspection,
	type JbcentralStatusObservation,
	jbcentralExtensionPath,
	launchJbcentralLogin,
	probeJbcentralStatus,
	runJbcentralAction,
	watchJbcentralArtifact,
} from "@thinkrail/shared/jbcentral";
import {
	activatePiRuntimeGeneration,
	configurePiRuntimeSessionExtensionExclusions,
	preparePiRuntimeGeneration,
} from "../agent";

const REBUILD_DEBOUNCE_MS = 75;

const STATUS_TTL_MS = JBCENTRAL_STATUS_TTL_MS;

type RebuildResult =
	| { outcome: "applied"; configured: boolean }
	| { outcome: "failed"; reason: "candidate-failed"; configured: boolean };

interface RebuildWaiter {
	sequence: number;
	resolve: (result: RebuildResult) => void;
}

let appliedConfigured = false;
let statusObservation: JbcentralStatusObservation = { auth: "unknown", proxy: "unknown" };
let statusProbedAt = 0;
let statusGeneration = 0;
let statusTask: Promise<void> | null = null;
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

export function setJbcentralAppliedPublisher(publisher: () => void): void {
	publishApplied = publisher;
}

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
			const signedOut = statusObservation.auth === "signed-out";
			return inspection.status.configured
				? {
						state: "configured",
						version: inspection.status.version,
						signedOut,
						proxyStopped: statusObservation.proxy === "stopped",
					}
				: { state: "supported", version: inspection.status.version, signedOut };
		}
	}
}

function invalidateStatusObservation(): void {
	statusProbedAt = 0;
	statusGeneration += 1;
}

function sameStatusObservation(
	left: JbcentralStatusObservation,
	right: JbcentralStatusObservation,
): boolean {
	return left.auth === right.auth && left.proxy === right.proxy;
}

function applyStatusObservation(observation: JbcentralStatusObservation): void {
	statusProbedAt = Date.now();
	if (sameStatusObservation(observation, statusObservation)) return;
	statusObservation = observation;
	publishChanged();
}

function refreshStatusIfStale(): void {
	if (stopped || statusTask || Date.now() - statusProbedAt < STATUS_TTL_MS) return;
	const generation = statusGeneration;
	const task = (async () => {
		const observation = await probeJbcentralStatus();
		if (stopped || generation !== statusGeneration) return;
		applyStatusObservation(observation);
	})();
	statusTask = task;
	void task
		.catch(() => {})
		.finally(() => {
			if (statusTask === task) statusTask = null;
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

export async function getJbcentralStatus(): Promise<JbcentralStatus> {
	await initializeJbcentralRuntime();
	if (transientAction || settledSequence < requestedSequence) return configuringStatus();

	const inspection = await inspectJbcentral();
	const configured = inspectionConfigured(inspection);
	if (loadFailure) {
		if (configured === loadFailure.configured) return loadFailure;
		void requestRuntimeRebuild();
		return configuringStatus();
	}
	if (configured !== appliedConfigured) {
		void requestRuntimeRebuild();
		return configuringStatus();
	}
	if (inspection.status.state === "supported") refreshStatusIfStale();
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
			invalidateStatusObservation();
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

async function startProxy(): Promise<JbcentralActionResult> {
	transientAction = "start-proxy";
	publishChanged();
	try {
		const inspection = await inspectJbcentral();
		const preflightFailure = inspectionFailure(inspection);
		if (preflightFailure) return preflightFailure;
		if (!inspectionConfigured(inspection) || !appliedConfigured) {
			return failed("central-action-failed");
		}

		const result = await runJbcentralAction("start-proxy");
		invalidateStatusObservation();
		const actionFailure = mapCliFailure(result);
		if (actionFailure) return failed(actionFailure);
		if (result.outcome === "succeeded" && result.observation) {
			applyStatusObservation(result.observation);
		}
		return { outcome: "applied" };
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

export function startProxyJbcentral(): Promise<JbcentralActionResult> {
	return scheduleAction("start-proxy", startProxy);
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
					invalidateStatusObservation();
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
	await Promise.allSettled([actionTail, rebuildTask, statusTask]);
	appliedConfigured = false;
	statusObservation = { auth: "unknown", proxy: "unknown" };
	statusProbedAt = 0;
	statusGeneration = 0;
	statusTask = null;
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
