/**
 * The remote-check scheduler (see SPEC.md), both halves. MECHANICS (`./remotes`): when a check runs — the
 * per-project floor, the jittered backstop, start/stop, the no-client gate, and the injected
 * clock/timer/random seams. POLICY (`./policy`): what a check does — ref derivation, the credential
 * ladder's dormancy reasons, per-pair backoff, and turning a probe/fetch result into `RemoteState`. `Host`
 * wiring passes policy's `checkProject` to mechanics' `startRemoteChecks` — out of scope for this module
 * itself (see SPEC.md).
 */

export {
	BACKOFF_BASE_MS,
	BACKOFF_MAX_MS,
	checkProject,
	REMOTE_CHECK_TIMEOUT_MS,
	type RemoteCheckPolicyDeps,
	remoteStateFor,
	setRemoteStatePublisher,
} from "./policy";
export {
	type CheckProjectFn,
	checkNow,
	configureRemoteChecks,
	JITTER_FRACTION,
	MIN_CHECK_INTERVAL_MS,
	noteClientActivity,
	type RemoteCheckDeps,
	startRemoteChecks,
	stopRemoteChecks,
	type TimerHandle,
} from "./remotes";
