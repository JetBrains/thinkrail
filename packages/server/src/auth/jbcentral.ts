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
	cleanupLegacyJbcentralModels,
	inspectJbcentral,
	type JbcentralInspection,
	type LegacyCleanupReceipt,
	type LegacyCleanupResult,
	launchJbcentralLogin,
	rollbackLegacyJbcentralCleanup,
	runJbcentralAction,
} from "@thinkrail/shared/jbcentral";
import {
	configurePiRuntimeExtensionPaths,
	configurePiRuntimeSessionExtensionExclusions,
	type PiRuntimeReconciliationBoundary,
	type PiRuntimeReconciliationResult,
	withPiRuntimeReconciliationBoundary,
} from "../agent";

interface ActionExecution {
	response: Promise<JbcentralActionResult>;
	completion: Promise<void>;
}

interface ActionFlight {
	response: Promise<JbcentralActionResult>;
	completion: Promise<void>;
}

let transientStatus: JbcentralStatus | null = null;
let recoveryStatus: JbcentralStatus | null = null;
let appliedConfigured = false;
let bootstrapped = false;
let bootstrapTask: Promise<void> | null = null;
let actionTail = Promise.resolve();
const actionFlights = new Map<JbcentralAction, ActionFlight>();
let driftTask: Promise<void> | null = null;
let loginTask: Promise<JbcentralLoginResult> | null = null;
let publishApplied: () => void = () => {};

/** Host composition seam: analytics may observe only the closed `applied` transition. */
export function setJbcentralAppliedPublisher(publisher: () => void): void {
	publishApplied = publisher;
}

function completed(result: JbcentralActionResult): ActionExecution {
	return { response: Promise.resolve(result), completion: Promise.resolve() };
}

function failed(reason: JbcentralActionFailureReason): JbcentralActionResult {
	return { outcome: "failed", reason };
}

function setRecovery(action: JbcentralAction, reason: JbcentralActionFailureReason): void {
	transientStatus = null;
	recoveryStatus = { state: "recovery-required", action, reason };
}

function setBlocked(
	action: Exclude<JbcentralAction, "update">,
	affectedSessionIds: string[],
): void {
	transientStatus = {
		state: "blocked",
		action,
		reason: "model-unavailable",
		affectedSessionIds,
	};
	recoveryStatus = null;
}

function mapInspectionStatus(inspection: JbcentralInspection): JbcentralStatus {
	switch (inspection.status.state) {
		case "absent":
			return { state: "absent" };
		case "outdated":
			return { state: "outdated", version: inspection.status.version };
		case "unreviewed":
			return { state: "unreviewed", version: inspection.status.version };
		case "malformed-version":
			return { state: "malformed-version" };
		case "probe-failed":
			return { state: "probe-failed", reason: inspection.status.reason };
		case "supported":
			return inspection.status.configured
				? { state: "configured", version: inspection.status.version }
				: { state: "supported", version: inspection.status.version };
	}
}

function inspectionFailure(inspection: JbcentralInspection): JbcentralActionResult | null {
	switch (inspection.status.state) {
		case "absent":
			return failed("not-installed");
		case "outdated":
		case "unreviewed":
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

function mapCleanupFailure(result: LegacyCleanupResult): JbcentralActionFailureReason | null {
	if (result.outcome !== "failed") return null;
	switch (result.reason) {
		case "invalid-json":
			return "legacy-cleanup-invalid";
		case "conflict":
			return "legacy-cleanup-conflict";
		case "io-error":
			return "legacy-cleanup-failed";
	}
}

async function rollbackCleanup(receipt: LegacyCleanupReceipt | undefined): Promise<boolean> {
	if (!receipt) return true;
	const result = await rollbackLegacyJbcentralCleanup(receipt);
	return result.outcome === "rolled-back";
}

async function restoreCentralArtifact(): Promise<boolean> {
	return (await runJbcentralAction("add")).outcome === "succeeded";
}

function mapReconciliationFailure(
	result: Exclude<PiRuntimeReconciliationResult, { outcome: "applied" | "blocked" }>,
): JbcentralActionFailureReason {
	return result.reason;
}

function startBoundary(
	action: "connect" | "disconnect",
	operation: (boundary: PiRuntimeReconciliationBoundary) => Promise<JbcentralActionResult>,
): ActionExecution {
	let reportPending: (() => void) | undefined;
	const pending = new Promise<JbcentralActionResult>((resolve) => {
		reportPending = () => resolve({ outcome: "pending" });
	});
	const boundary = withPiRuntimeReconciliationBoundary(
		async (reconciliation) => {
			try {
				return await operation(reconciliation);
			} catch (error) {
				// An unclassified failure cannot prove either global state or the candidate generation coherent.
				reconciliation.keepAdmissionClosed();
				throw error;
			}
		},
		{
			onPending: () => {
				transientStatus = { state: "pending", action };
				reportPending?.();
			},
		},
	);
	const finalResult = boundary.catch(() => {
		setRecovery(action, "reattach-failed");
		return failed("reattach-failed");
	});
	return {
		response: Promise.race([finalResult, pending]),
		completion: finalResult.then(() => undefined),
	};
}

async function beginConnect({
	invokeCentral,
}: {
	invokeCentral: boolean;
}): Promise<ActionExecution> {
	const priorRecovery = recoveryStatus;
	const finishPreflightFailure = (result: JbcentralActionResult): JbcentralActionResult => {
		transientStatus = null;
		// A failed repair attempt must not erase the recovery seal/status that admitted it.
		if (priorRecovery) recoveryStatus = priorRecovery;
		return result;
	};
	transientStatus = { state: "configuring", action: "connect" };
	recoveryStatus = null;
	return startBoundary("connect", async (boundary) => {
		const inspection = await inspectJbcentral();
		const preflightFailure = inspectionFailure(inspection);
		if (preflightFailure) return finishPreflightFailure(preflightFailure);
		if (inspection.status.state !== "supported") {
			return finishPreflightFailure(failed("unsupported-version"));
		}

		if (invokeCentral) {
			const actionFailure = mapCliFailure(await runJbcentralAction("add"));
			if (actionFailure) return finishPreflightFailure(failed(actionFailure));
		}

		const cleanup = await cleanupLegacyJbcentralModels();
		const cleanupFailure = mapCleanupFailure(cleanup);
		if (cleanupFailure) {
			setRecovery("connect", cleanupFailure);
			boundary.keepAdmissionClosed();
			return failed(cleanupFailure);
		}
		const receipt = cleanup.outcome === "cleaned" ? cleanup.receipt : undefined;
		const result = await boundary.replaceGeneration([inspection.extensionPath]);
		if (result.outcome === "applied") {
			appliedConfigured = true;
			transientStatus = null;
			recoveryStatus = null;
			if (invokeCentral) publishApplied();
			return { outcome: "applied" };
		}

		const rolledBack = await rollbackCleanup(receipt);
		if (!rolledBack) {
			setRecovery("connect", "recovery-failed");
			boundary.keepAdmissionClosed();
			return failed("recovery-failed");
		}
		if (result.outcome === "blocked") {
			setBlocked("connect", result.affectedSessionIds);
			return {
				outcome: "blocked",
				reason: "model-unavailable",
				affectedSessionIds: result.affectedSessionIds,
			};
		}
		const reason = mapReconciliationFailure(result);
		setRecovery("connect", reason);
		return failed(reason);
	});
}

async function beginDisconnect({
	invokeCentral,
}: {
	invokeCentral: boolean;
}): Promise<ActionExecution> {
	const priorRecovery = recoveryStatus;
	const finishPreflightFailure = (result: JbcentralActionResult): JbcentralActionResult => {
		transientStatus = null;
		if (priorRecovery) recoveryStatus = priorRecovery;
		return result;
	};
	transientStatus = { state: "configuring", action: "disconnect" };
	recoveryStatus = null;
	return startBoundary("disconnect", async (boundary) => {
		const inspection = await inspectJbcentral();
		const preflightFailure = inspectionFailure(inspection);
		if (preflightFailure) return finishPreflightFailure(preflightFailure);
		if (inspection.status.state !== "supported") {
			return finishPreflightFailure(failed("unsupported-version"));
		}

		if (invokeCentral) {
			const actionFailure = mapCliFailure(await runJbcentralAction("remove"));
			if (actionFailure) {
				let repaired = false;
				const afterFailure = await inspectJbcentral();
				if (
					appliedConfigured &&
					afterFailure.status.state === "supported" &&
					!afterFailure.status.configured
				) {
					if (!(await restoreCentralArtifact())) {
						setRecovery("disconnect", "recovery-failed");
						boundary.keepAdmissionClosed();
						return failed("recovery-failed");
					}
					const restored = await boundary.replaceGeneration([inspection.extensionPath]);
					if (restored.outcome !== "applied") {
						setRecovery("disconnect", "recovery-failed");
						boundary.keepAdmissionClosed();
						return failed("recovery-failed");
					}
					repaired = true;
				}
				transientStatus = null;
				if (priorRecovery && !repaired) recoveryStatus = priorRecovery;
				return failed(actionFailure);
			}
		}

		const result = await boundary.replaceGeneration([]);
		if (result.outcome === "applied") {
			appliedConfigured = false;
			transientStatus = null;
			recoveryStatus = null;
			return { outcome: "applied" };
		}

		if (!(await restoreCentralArtifact())) {
			setRecovery("disconnect", "recovery-failed");
			boundary.keepAdmissionClosed();
			return failed("recovery-failed");
		}
		const restored = await boundary.replaceGeneration([inspection.extensionPath]);
		if (restored.outcome !== "applied") {
			setRecovery("disconnect", "recovery-failed");
			boundary.keepAdmissionClosed();
			return failed("recovery-failed");
		}
		appliedConfigured = true;
		if (result.outcome === "blocked") {
			setBlocked("disconnect", result.affectedSessionIds);
			return {
				outcome: "blocked",
				reason: "model-unavailable",
				affectedSessionIds: result.affectedSessionIds,
			};
		}
		transientStatus = null;
		recoveryStatus = null;
		return failed(mapReconciliationFailure(result));
	});
}

async function beginUpdate(): Promise<ActionExecution> {
	const priorRecovery = recoveryStatus;
	const finishUpdate = (result: JbcentralActionResult): ActionExecution => {
		transientStatus = null;
		// Updating the CLI does not reconcile a sealed runtime; preserve any pre-existing recovery state.
		if (priorRecovery) recoveryStatus = priorRecovery;
		return completed(result);
	};
	transientStatus = { state: "configuring", action: "update" };
	const before = await inspectJbcentral();
	if (before.status.state === "supported") return finishUpdate({ outcome: "applied" });
	if (before.status.state !== "outdated") {
		return finishUpdate(inspectionFailure(before) ?? failed("unsupported-version"));
	}

	const actionFailure = mapCliFailure(await runJbcentralAction("update"));
	if (actionFailure) return finishUpdate(failed(actionFailure));
	const after = await inspectJbcentral();
	const postflightFailure = inspectionFailure(after);
	return finishUpdate(postflightFailure ?? { outcome: "applied" });
}

function scheduleAction(
	action: JbcentralAction,
	begin: () => Promise<ActionExecution>,
): Promise<JbcentralActionResult> {
	const existing = actionFlights.get(action);
	if (existing) return existing.response;

	const started = actionTail.then(begin);
	const response = started
		.then((execution) => execution.response)
		.catch(() => {
			if (action === "update") {
				transientStatus = null;
				return failed("central-action-failed");
			}
			setRecovery(action, "recovery-failed");
			return failed("recovery-failed");
		});
	const completion = started
		.then((execution) => execution.completion)
		.catch(() => undefined)
		.then(() => undefined);
	const flight = { response, completion };
	actionFlights.set(action, flight);
	actionTail = completion;
	void completion.then(() => {
		if (actionFlights.get(action) === flight) actionFlights.delete(action);
	});
	return response;
}

/** Initialize the active PI generation from safe Central postconditions before any chat/runtime read. */
export function initializeJbcentralRuntime(): Promise<void> {
	if (bootstrapTask) return bootstrapTask;
	bootstrapTask = (async () => {
		const inspection = await inspectJbcentral();
		// Always exclude the reviewed global identity from ordinary session discovery. Unsupported or
		// recovery-blocked artifacts must not execute merely because the default PI agent dir can see them.
		configurePiRuntimeSessionExtensionExclusions([inspection.extensionPath]);
		configurePiRuntimeExtensionPaths([]);
		if (inspection.status.state !== "supported" || !inspection.status.configured) {
			appliedConfigured = false;
			bootstrapped = true;
			return;
		}

		await withPiRuntimeReconciliationBoundary(async (boundary) => {
			const cleanup = await cleanupLegacyJbcentralModels();
			const cleanupFailure = mapCleanupFailure(cleanup);
			if (cleanupFailure) {
				setRecovery("connect", cleanupFailure);
				boundary.keepAdmissionClosed();
				return;
			}
			const receipt = cleanup.outcome === "cleaned" ? cleanup.receipt : undefined;
			const reconciled = await boundary.replaceGeneration([inspection.extensionPath]);
			if (reconciled.outcome === "applied") {
				appliedConfigured = true;
				return;
			}

			const rolledBack = await rollbackCleanup(receipt);
			if (!rolledBack) {
				setRecovery("connect", "recovery-failed");
				boundary.keepAdmissionClosed();
				return;
			}
			setRecovery(
				"connect",
				reconciled.outcome === "failed" ? reconciled.reason : "candidate-failed",
			);
		});
		bootstrapped = true;
	})().catch(async () => {
		bootstrapped = true;
		setRecovery("connect", "recovery-failed");
		await withPiRuntimeReconciliationBoundary(async (boundary) => {
			boundary.keepAdmissionClosed();
		});
	});
	return bootstrapTask;
}

function scheduleExternalDrift(configured: boolean): void {
	if (driftTask || transientStatus || recoveryStatus) return;
	const action = configured ? "connect" : "disconnect";
	const response = scheduleAction(action, () =>
		configured ? beginConnect({ invokeCentral: false }) : beginDisconnect({ invokeCentral: false }),
	);
	const flight = actionFlights.get(action);
	driftTask = (flight?.completion ?? response.then(() => undefined)).finally(() => {
		driftTask = null;
	});
}

/** Closed status projection plus external artifact drift detection through the same reconcile path. */
export async function getJbcentralStatus(): Promise<JbcentralStatus> {
	await initializeJbcentralRuntime();
	if (transientStatus) return transientStatus;
	if (recoveryStatus) return recoveryStatus;

	const inspection = await inspectJbcentral();
	if (
		bootstrapped &&
		inspection.status.state === "supported" &&
		inspection.status.configured !== appliedConfigured
	) {
		scheduleExternalDrift(inspection.status.configured);
		return (
			transientStatus ?? {
				state: "pending",
				action: inspection.status.configured ? "connect" : "disconnect",
			}
		);
	}
	return mapInspectionStatus(inspection);
}

export async function resetJbcentralStateForTests(): Promise<void> {
	await actionTail;
	await driftTask;
	transientStatus = null;
	recoveryStatus = null;
	appliedConfigured = false;
	bootstrapped = false;
	bootstrapTask = null;
	actionTail = Promise.resolve();
	actionFlights.clear();
	driftTask = null;
	loginTask = null;
	publishApplied = () => {};
}

export function connectJbcentral(): Promise<JbcentralConnectResult> {
	return scheduleAction("connect", () => beginConnect({ invokeCentral: true }));
}

export function disconnectJbcentral(): Promise<JbcentralActionResult> {
	return scheduleAction("disconnect", () => beginDisconnect({ invokeCentral: true }));
}

export function updateJbcentral(): Promise<JbcentralActionResult> {
	return scheduleAction("update", beginUpdate);
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
				case "unreviewed":
				case "malformed-version":
					return { outcome: "failed", reason: "unsupported-version" };
				case "probe-failed":
					return { outcome: "failed", reason: "version-probe-failed" };
				case "supported":
					return launchJbcentralLogin();
			}
		})
		.catch((): JbcentralLoginResult => ({ outcome: "failed", reason: "launch-failed" }));
	loginTask = task;
	actionTail = task.then(() => undefined);
	void task.then(() => {
		if (loginTask === task) loginTask = null;
	});
	return task;
}
