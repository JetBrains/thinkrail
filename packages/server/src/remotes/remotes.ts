// The remote-check scheduler's MECHANICS half (see SPEC.md for the split): WHEN a check runs, never WHY
// or HOW. This module is handed an opaque "check this project" callback and decides only the timing —
// a per-project floor that collapses focus/reconnect thrash, a jittered self-rescheduling backstop timer
// as the fallback when nothing nudges it, a hard gate so nothing runs before any client has ever shown
// up, and enough Promise hygiene that one project's failure can never take down another project's check
// or the scheduling loop itself. It knows nothing about git refs, credentials, trust, or dormancy — the
// project-id set it drives comes from `persistence.loadProjects()` (worktrees share one `.git`, so this
// is tracked per PROJECT, never per workspace), and what actually happens for a given project id is
// entirely the injected `checkProject` callback's business.
import type { AppConfig } from "@thinkrail/contracts";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import { loadProjects } from "../persistence";

/**
 * "Check this project" — opaque to the scheduler. The real implementation (deriving a project's
 * remote-tracking refs from its workspaces, probing/fetching them, applying the credential ladder + the
 * per-pair backoff, and publishing the resulting `RemoteState`) is a separate concern layered on top of
 * this file; this module only ever calls it, on a schedule, and swallows its rejection (see
 * {@link requestCheck} — the Promise-hygiene rule: a rejection here can never propagate into another
 * project's check or kill the self-rescheduling backstop loop).
 */
export type CheckProjectFn = (projectId: string) => Promise<void>;

/** An opaque handle returned by an injected `setTimer`, round-tripped back to `clearTimer` unexamined —
 * the module never inspects it, so a test double can use anything (a number, an object, …). */
export type TimerHandle = unknown;

export interface RemoteCheckDeps {
	/** The one thing this module doesn't know how to do — see {@link CheckProjectFn}. */
	checkProject: CheckProjectFn;
	/** Test seam for the clock; defaults to `Date.now`. */
	now?: () => number;
	/** Test seam for scheduling; defaults to the real `setTimeout`. Never `setInterval` — a
	 * self-rescheduling one-shot is what lets the jitter differ every round (see {@link JITTER_FRACTION}). */
	setTimer?: (fn: () => void, ms: number) => TimerHandle;
	/** Test seam for cancellation; defaults to the real `clearTimeout`. */
	clearTimer?: (handle: TimerHandle) => void;
	/** Test seam for the backstop's jitter draw, `[0, 1)`; defaults to `Math.random`. */
	random?: () => number;
}

/**
 * The anti-thrash floor: three focus/reconnect nudges landing inside this window collapse into ONE check
 * per project, whichever *recurring* trigger (activity sweep, `checkNow`, the backstop) asked for it. Fixed,
 * not configurable — `AppConfig` has no floor knob, only the backstop interval does.
 *
 * The one exception is a **mode change** (see {@link configureRemoteChecks}), which passes `ignoreFloor`.
 * The floor exists to collapse *repeated, automatic* nudges; a mode change is a deliberate, rare edit whose
 * whole point is that every pair's published state is now describing the wrong mode, and it would otherwise
 * be silently dropped exactly when it matters most — a user toggling the setting seconds after a check ran.
 * In-flight de-duplication still applies to it; only the time-based floor is skipped.
 */
export const MIN_CHECK_INTERVAL_MS = 60_000;

/**
 * The backstop's jitter, added ON TOP of the configured interval — deliberately never a fixed delay (a
 * fixed delay would let many clients' backstops synchronise onto the same instant, exactly the failure
 * GitHub Desktop's own skewed interval exists to avoid). A round's delay lands in
 * `[intervalMs, intervalMs * (1 + JITTER_FRACTION))` — see {@link nextBackstopDelay}.
 */
export const JITTER_FRACTION = 0.2;

interface ProjectCheckState {
	/** `now()` at the moment the last check for this project STARTED (not finished) — the floor is
	 * measured from when we committed to checking, so two near-simultaneous requests can't both slip
	 * through before either resolves. */
	lastCheckedAt: number | null;
	/** The in-flight check, if any — de-dupes a second trigger for the SAME project while one is still
	 * running, distinct from (and in addition to) the time floor. Always a never-rejecting promise (its
	 * rejection is caught before it's ever stored here). */
	inFlight: Promise<void> | null;
}

const projectStates = new Map<string, ProjectCheckState>();

function stateFor(projectId: string): ProjectCheckState {
	let state = projectStates.get(projectId);
	if (!state) {
		state = { lastCheckedAt: null, inFlight: null };
		projectStates.set(projectId, state);
	}
	return state;
}

// ── injected config (from `host`, exactly as `setAnalyticsSending` already is — see SPEC.md) ─────────

let intervalMs = DEFAULT_CONFIG.gitRemoteCheckIntervalMinutes * 60_000;

/** The most recently injected `gitRemoteCheck` mode — see {@link currentGitRemoteCheckMode}. */
let gitRemoteCheckMode: AppConfig["gitRemoteCheck"] = DEFAULT_CONFIG.gitRemoteCheck;

/**
 * Apply the host's already-validated config. Task 4's `updateConfig` clamps `gitRemoteCheckIntervalMinutes`
 * to `[1, 1440]` minutes before this ever sees it, so this function does not re-validate and never imports
 * `settings` (the module boundary this repo enforces for every config consumer).
 *
 * The interval drives THIS module's own scheduling. `gitRemoteCheck` (`"probe" | "fetch" | "off"`) is a
 * DORMANCY concern, not a timing one: this scheduler keeps inviting `checkProject` on schedule regardless
 * of that value — it is only cached here (see {@link currentGitRemoteCheckMode}) so the POLICY half can
 * read it without either half importing `settings`. `"off"` is reported honestly as `dormant: "disabled"`
 * PER PAIR by whatever implements `checkProject`, never by this scheduler silently going dark.
 *
 * Rearms the backstop immediately when already running, so a live interval change (e.g. a Settings edit)
 * takes effect at once rather than waiting out whatever was left of the old interval.
 *
 * A changed **mode** additionally sweeps every known project right away. Rearming alone would only change
 * *when* the next check happens — every pair's already-published `RemoteState` would keep describing the
 * OLD mode until then, which for the maximum 1440-minute interval is a full day of the UI contradicting
 * the setting the user just changed: switching to `"off"` would leave a live `↓` (and no `dormant`
 * explanation) instead of the `disabled` state, and switching back would leave `disabled` displayed on a
 * pair that is being checked again. The sweep re-derives each pair through the normal `checkProject` path,
 * so dormancy, the credential ladder and backoff all still apply — nothing is short-circuited.
 */
export function configureRemoteChecks(config: AppConfig): void {
	const modeChanged = config.gitRemoteCheck !== gitRemoteCheckMode;
	intervalMs = config.gitRemoteCheckIntervalMinutes * 60_000;
	gitRemoteCheckMode = config.gitRemoteCheck;
	if (!running) return; // boot order: host configures before `startRemoteChecks` arms anything
	rearmBackstop();
	// Deliberately NOT for an interval-only edit: that changes cadence, not what any pair's state means,
	// and a settings save should not quietly become a fleet-wide network round.
	if (modeChanged) {
		for (const p of loadProjects()) void requestCheck(p.id, { ignoreFloor: true });
	}
}

/**
 * The most recently injected `gitRemoteCheck` mode, defaulting to `DEFAULT_CONFIG.gitRemoteCheck` until
 * `configureRemoteChecks` is ever called. Read directly by `policy.ts` (a same-module file import, not
 * through the barrel — see SPEC.md) so it can report `dormant: "disabled"` per pair, and pick probe vs.
 * fetch, without this file or that one importing `settings`.
 */
export function currentGitRemoteCheckMode(): AppConfig["gitRemoteCheck"] {
	return gitRemoteCheckMode;
}

// ── lifecycle state (module-singleton, matching every sibling feature's injected-dependency pattern) ──

/** Production `setTimer`: the real `setTimeout`, widened to the opaque {@link TimerHandle} contract. */
function defaultSetTimer(fn: () => void, ms: number): TimerHandle {
	return setTimeout(fn, ms);
}

/** Production `clearTimer`, paired with {@link defaultSetTimer}: the handle it's given back is always
 * one it minted itself, so narrowing it back to `setTimeout`'s own handle type is safe. */
function defaultClearTimer(handle: TimerHandle): void {
	clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
}

let checkProject: CheckProjectFn = () => Promise.resolve();
let nowFn: () => number = Date.now;
let setTimerFn: (fn: () => void, ms: number) => TimerHandle = defaultSetTimer;
let clearTimerFn: (handle: TimerHandle) => void = defaultClearTimer;
let randomFn: () => number = Math.random;

let running = false;
/** Latched true by the first {@link noteClientActivity} — never reset to false by this module (it owns
 * no WS lifecycle, so it has no "the last client left" signal of its own). Gates the BACKSTOP only:
 * `checkNow`/an activity sweep are themselves proof a client is here, so they're never gated by this. */
let hasClient = false;
let backstopHandle: TimerHandle = null;

/**
 * Arm the scheduler: install the dependencies (production defaults for anything omitted), reset every
 * project's floor/in-flight state (a fresh run starts clean — leftover timing from a previous life, e.g.
 * a previous test, must never suppress the first real check), and schedule the first backstop tick.
 * Does NOT check anything immediately — the backstop is the fallback path; an actual client's
 * `noteClientActivity`/`checkNow` drives the immediate path.
 */
export function startRemoteChecks(deps: RemoteCheckDeps): void {
	checkProject = deps.checkProject;
	nowFn = deps.now ?? Date.now;
	setTimerFn = deps.setTimer ?? defaultSetTimer;
	clearTimerFn = deps.clearTimer ?? defaultClearTimer;
	randomFn = deps.random ?? Math.random;
	projectStates.clear();
	hasClient = false;
	running = true;
	rearmBackstop();
}

/**
 * Disarm the scheduler — the one thing `server.stop()` must prove leaves no live timer. Idempotent
 * (calling it twice, or without a prior `startRemoteChecks`, is a no-op).
 */
export function stopRemoteChecks(): void {
	running = false;
	if (backstopHandle !== null) {
		clearTimerFn(backstopHandle);
		backstopHandle = null;
	}
}

/** `intervalMs * (1 + JITTER_FRACTION * draw)`, `draw` ∈ `[0, 1)` — see {@link JITTER_FRACTION}. */
function nextBackstopDelay(): number {
	return intervalMs * (1 + JITTER_FRACTION * randomFn());
}

/** Cancel any pending backstop timer and, while running, arm the next one with a freshly-drawn jitter —
 * the self-rescheduling `setTimeout` (never `setInterval`) that lets the jitter differ every round. */
function rearmBackstop(): void {
	if (backstopHandle !== null) {
		clearTimerFn(backstopHandle);
		backstopHandle = null;
	}
	if (!running) return;
	backstopHandle = setTimerFn(backstopTick, nextBackstopDelay());
}

function backstopTick(): void {
	// Defends the "no live timer survives `stop()`" guarantee against the rare real-clock race where a
	// timer had already fired before `clearTimeout` took effect: a stopped scheduler's tick is a pure
	// no-op, and — critically — never reschedules itself.
	if (!running) return;
	backstopHandle = null;
	if (hasClient) {
		for (const p of loadProjects()) void requestCheck(p.id);
	}
	rearmBackstop();
}

/**
 * A client is here and doing something (WS connect, tab focus, reconnect) — the ONE signal this module
 * has for "someone might care right now". Latches "a client has been seen" (see {@link hasClient}, which
 * gates the backstop) and immediately sweeps every currently-known project through the same floored path
 * as every other trigger, so a burst of nudges collapses to one check per project, not one per nudge.
 */
export function noteClientActivity(): void {
	hasClient = true;
	for (const p of loadProjects()) void requestCheck(p.id);
}

/**
 * Ask for `projectId` to be checked now, subject to the same per-project floor as every other trigger.
 * Never rejects — a failing check is caught and logged (see {@link requestCheck}), never thrown at the
 * caller — so a host RPC handler can safely `await` this without its own try/catch.
 */
export function checkNow(projectId: string): Promise<void> {
	return requestCheck(projectId);
}

/**
 * The one path every trigger (an activity sweep, the backstop tick, `checkNow`, a mode change) funnels
 * through: de-dupe a check already in flight for this project, floor-gate against `MIN_CHECK_INTERVAL_MS`
 * (unless `opts.ignoreFloor` — see that constant's doc for the single caller that does), and —
 * the Promise-hygiene rule this module is on the hook for — catch `checkProject`'s failure right here, so
 * it can never propagate into another project's check or the self-rescheduling backstop loop. Skipped
 * requests (in-flight dedupe or the floor) resolve immediately with nothing to await.
 *
 * The call is wrapped in `Promise.resolve().then(...)` rather than invoked directly: `CheckProjectFn`'s
 * type signature promises a `Promise<void>`, but nothing enforces that at runtime, and a real
 * implementation could throw SYNCHRONOUSLY before ever constructing one (a non-`async` function doing a
 * synchronous git call, say). A direct call's synchronous throw would escape this function entirely —
 * uncaught by the `.catch` below, since it never even gets attached — and abort the `for` loop in
 * whichever caller (`noteClientActivity`/`backstopTick`) is mid-sweep over the REMAINING projects. Routing
 * the call through an already-resolved `.then` turns that synchronous throw into an ordinary rejection,
 * so it is caught exactly like an async failure.
 */
function requestCheck(projectId: string, opts: { ignoreFloor?: boolean } = {}): Promise<void> {
	const state = stateFor(projectId);
	// Never bypassed, whatever the caller asked for: two concurrent checks of one project would duplicate
	// the network round AND race each other's published snapshot.
	if (state.inFlight) return state.inFlight;

	const now = nowFn();
	if (
		!opts.ignoreFloor &&
		state.lastCheckedAt !== null &&
		now - state.lastCheckedAt < MIN_CHECK_INTERVAL_MS
	) {
		return Promise.resolve();
	}

	state.lastCheckedAt = now;
	const run: Promise<void> = Promise.resolve()
		.then(() => checkProject(projectId))
		.catch((err: unknown) => {
			console.warn(
				`remote check failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
			);
		})
		.finally(() => {
			if (state.inFlight === run) state.inFlight = null;
		});
	state.inFlight = run;
	return run;
}
