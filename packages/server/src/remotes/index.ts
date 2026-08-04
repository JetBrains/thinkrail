/**
 * The remote-check scheduler (see SPEC.md). This barrel currently exports only the MECHANICS half
 * (when a check runs): the per-project floor, the jittered backstop, start/stop, the no-client gate, and
 * the injected clock/timer/random seams. `remoteStateFor`/`setRemoteStatePublisher` — the POLICY half
 * (what we learned, published) — land with the follow-up task that also supplies the real
 * `CheckProjectFn`; see SPEC.md's "Not yet implemented" section.
 */
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
