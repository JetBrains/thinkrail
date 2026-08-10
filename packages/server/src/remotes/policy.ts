// The remote-check scheduler's POLICY half (see SPEC.md): WHAT `checkProject` does, never WHEN — that's
// `remotes.ts`. Given a project id, this module derives which remote-tracking refs matter, walks the
// credential ladder to decide whether each is even eligible to be checked right now, batches the eligible
// ones into a single probe/fetch call, turns the result into an honest `RemoteState` (never substituting a
// guess for what a probe genuinely can't know), applies per-pair exponential backoff on failure, and
// publishes the resulting per-project snapshot.
import type {
	AppConfig,
	Project,
	ProjectRemoteStatePayload,
	RemoteDormantReason,
	RemoteState,
} from "@thinkrail/contracts";
import {
	diffBaseRef,
	fetchRemoteRefs,
	probeRemoteRefs,
	refDelta,
	remoteUrlKind,
	sshAgentPresent,
	trackingRefOid,
} from "../git";
import { isRemoteTrusted, loadProjects, loadWorkspaces } from "../persistence";
import type { CheckProjectFn } from "./remotes";
import { currentGitRemoteCheckMode } from "./remotes";

// Re-exported for `host` — see the `fetchRefNow` doc below for why the write side of the ladder's rung 2
// belongs there, not here.
export { noteRemoteTrusted } from "../persistence";

// ── ref derivation ────────────────────────────────────────────────────────

/** This app hardcodes a single remote everywhere else too (`git.ts`'s `listBranches`/
 * `resolveDefaultBranch`/`prefetchBranch`) — see SPEC.md for why this module keeps that assumption rather
 * than generalising to a repo with several remotes nothing else here supports. */
const REMOTE_NAME = "origin";
const REMOTE_TRACKING_PREFIX = `${REMOTE_NAME}/`;

function isRemoteTrackingRef(ref: string): boolean {
	return ref.startsWith(REMOTE_TRACKING_PREFIX) && ref.length > REMOTE_TRACKING_PREFIX.length;
}

function shortNameOf(ref: string): string {
	return ref.slice(REMOTE_TRACKING_PREFIX.length);
}

/**
 * The distinct remote-tracking refs a project's workspaces care about — every workspace's
 * `diffBaseRef(ws)` (the `git` module's single collapse point for `diffBase ?? baseBranch`; never
 * re-derived here), deduplicated, keeping only the `"origin/…"`-shaped ones. A workspace based on a local
 * branch contributes nothing: there is no remote to check it against.
 */
export function refsForProject(projectId: string): string[] {
	const refs = new Set<string>();
	for (const ws of loadWorkspaces()) {
		if (ws.projectId !== projectId) continue;
		const ref = diffBaseRef(ws);
		if (isRemoteTrackingRef(ref)) refs.add(ref);
	}
	return [...refs];
}

// ── per-pair state (in-memory, reset on process restart — see SPEC.md) ───

interface PairRecord {
	behind: number | "unknown" | null;
	lastCheckedAt: string | null;
	dormant: RemoteDormantReason | null;
	/** Consecutive failures since the last success; drives {@link backoffDelayFor}. */
	failureCount: number;
	/** `now()` before which a "failing" pair is not retried; `null` when not backed off. */
	nextRetryAt: number | null;
	/**
	 * The stderr from the most recent failed probe/fetch attempt for this pair (`git/remoteRefs.ts`'s
	 * `probeRemoteRefs`/`fetchRemoteRefs` both document their failure answer as "the stderr, never
	 * swallowed" — this is where that promise is kept past `applyProbe`/`applyFetch`). `null` once a check
	 * completes successfully (see `markSuccess`). Internal only — `RemoteState` has no field for it, so the
	 * background scheduler's own failures never put raw stderr on the wire; only {@link fetchRefNow}'s
	 * thrown error (a user-initiated action that must say WHY it failed) reads this back out.
	 */
	lastError: string | null;
}

function defaultRecord(): PairRecord {
	return {
		behind: null,
		lastCheckedAt: null,
		dormant: null,
		failureCount: 0,
		nextRetryAt: null,
		lastError: null,
	};
}

const pairRecords = new Map<string, Map<string, PairRecord>>();

function recordFor(projectId: string, ref: string): PairRecord {
	let byRef = pairRecords.get(projectId);
	if (!byRef) {
		byRef = new Map();
		pairRecords.set(projectId, byRef);
	}
	let record = byRef.get(ref);
	if (!record) {
		record = defaultRecord();
		byRef.set(ref, record);
	}
	return record;
}

/**
 * Drops any `PairRecord` for this project whose ref is no longer in `currentRefs` — a workspace re-pointed
 * to a different base (or deleted) otherwise leaves its old ref's record in memory for the process's
 * entire remaining lifetime. Called once per `checkProject` round, before anything else, so it runs
 * regardless of mode/dormancy (a pruned ref that later reappears — e.g. a workspace re-pointed back —
 * starts from a fresh record, which is correct: nothing about its old state is still true).
 */
function pruneStaleRecords(projectId: string, currentRefs: string[]): void {
	const byRef = pairRecords.get(projectId);
	if (!byRef) return;
	const keep = new Set(currentRefs);
	for (const ref of byRef.keys()) {
		if (!keep.has(ref)) byRef.delete(ref);
	}
	if (byRef.size === 0) pairRecords.delete(projectId);
}

// ── backoff schedule ───────────────────────────────────────────────────────

/**
 * The first backoff delay, on the first failure — chosen well above the mechanics half's 60s activity
 * floor, so a single transient blip doesn't read identically to a genuinely broken remote; only repeated
 * failure pushes the gap up toward hours.
 */
export const BACKOFF_BASE_MS = 5 * 60_000; // 5 minutes

/**
 * The cap the doubling delay never exceeds — a permanently broken remote is retried at most once a day,
 * rather than backing off forever and becoming undiagnosable.
 */
export const BACKOFF_MAX_MS = 24 * 60 * 60_000; // 24 hours

/** Doubles per consecutive failure (5m, 10m, 20m, 40m, …), capped at {@link BACKOFF_MAX_MS}. */
function backoffDelayFor(failureCount: number): number {
	return Math.min(BACKOFF_BASE_MS * 2 ** (failureCount - 1), BACKOFF_MAX_MS);
}

/** Deadline for every `probeRemoteRefs`/`fetchRemoteRefs` call this module makes — generous for a healthy
 * remote, short enough that one stuck project doesn't stall a check round for long. */
export const REMOTE_CHECK_TIMEOUT_MS = 15_000;

// ── injected git-function + clock seam (production defaults; test-only override below) ──────────────────

export interface RemoteCheckPolicyDeps {
	probeRemoteRefs?: typeof probeRemoteRefs;
	fetchRemoteRefs?: typeof fetchRemoteRefs;
	refDelta?: typeof refDelta;
	remoteUrlKind?: typeof remoteUrlKind;
	sshAgentPresent?: typeof sshAgentPresent;
	localTrackingOid?: typeof trackingRefOid;
	now?: () => number;
}

let probeRemoteRefsFn: typeof probeRemoteRefs = probeRemoteRefs;
let fetchRemoteRefsFn: typeof fetchRemoteRefs = fetchRemoteRefs;
let refDeltaFn: typeof refDelta = refDelta;
let remoteUrlKindFn: typeof remoteUrlKind = remoteUrlKind;
let sshAgentPresentFn: typeof sshAgentPresent = sshAgentPresent;
let localTrackingOidFn: typeof trackingRefOid = trackingRefOid;
let nowFn: () => number = Date.now;

/**
 * Test-only seam (never barrel-exported — `policy.test.ts` imports this directly from `./policy`, exactly
 * as `remotes.test.ts` imports `startRemoteChecks` directly from `./remotes`). Installs fakes for every
 * git-module answer this module consumes plus the clock, defaulting anything omitted back to the real
 * implementation, and clears all in-memory `PairRecord` state — a previous test's pairs must never leak
 * into the next one.
 */
export function configureRemoteCheckPolicyDeps(deps: RemoteCheckPolicyDeps = {}): void {
	probeRemoteRefsFn = deps.probeRemoteRefs ?? probeRemoteRefs;
	fetchRemoteRefsFn = deps.fetchRemoteRefs ?? fetchRemoteRefs;
	refDeltaFn = deps.refDelta ?? refDelta;
	remoteUrlKindFn = deps.remoteUrlKind ?? remoteUrlKind;
	sshAgentPresentFn = deps.sshAgentPresent ?? sshAgentPresent;
	localTrackingOidFn = deps.localTrackingOid ?? trackingRefOid;
	nowFn = deps.now ?? Date.now;
	pairRecords.clear();
}

// ── the credential ladder (fixed precedence — see SPEC.md) ───────────────

/**
 * Rungs 2-5 of the ladder (rung 1, `"disabled"`, is checked once for the whole project before this is ever
 * called — see {@link checkProject}). `"upstream-gone"` comes first here: once a prior completed check
 * found this ref absent from the remote, that is a durable fact about the remote itself (not a credential
 * or local-policy question), so it stays excluded from every future batch without re-consulting trust or
 * ssh-agent state at all — see SPEC.md's "Design notes" for the sticky-until-restart tradeoff this implies.
 * `null` means eligible: add this ref to the network batch.
 *
 * `trusted`/`urlKind` are lazy thunks, not plain values, so that short-circuit stays real: `checkProject`
 * memoizes each on first actual use (see its own doc), and a round whose only ref is sticky `"upstream-gone"`
 * must invoke neither `isRemoteTrusted` (a `persistence` read) nor `remoteUrlKindFn` (a `git` subprocess) even
 * once — passing already-computed values would force both to run unconditionally before this is ever called,
 * for every round, defeating the sticky short-circuit `policy.test.ts` pins.
 */
function ladderReason(
	record: PairRecord,
	now: number,
	trusted: () => boolean,
	urlKind: () => "ssh" | "other" | "unknown",
): RemoteDormantReason | null {
	if (record.dormant === "upstream-gone") return "upstream-gone";
	if (!trusted()) return "never-authenticated";
	if (urlKind() === "ssh" && sshAgentPresentFn()) return "ssh-agent-present";
	if (record.nextRetryAt !== null && now < record.nextRetryAt) return "failing";
	return null;
}

// ── applying a probe/fetch result ─────────────────────────────────────────

function markFailure(projectId: string, names: string[], now: number, err: string): void {
	for (const name of names) {
		const record = recordFor(projectId, `${REMOTE_NAME}/${name}`);
		record.failureCount += 1;
		record.nextRetryAt = now + backoffDelayFor(record.failureCount);
		record.dormant = "failing";
		record.lastError = err;
		// behind/lastCheckedAt intentionally untouched: a failed attempt taught us nothing new about
		// either, and RemoteState's own contract says they reflect the last check that actually completed.
	}
}

/**
 * Records a check that actually completed — successfully finding either a `behind` value or (via
 * `dormant: "upstream-gone"`) that the ref no longer exists upstream. Both are real, informative outcomes,
 * unlike `markFailure`'s "the attempt itself didn't complete" — so both clear any live backoff.
 */
function markSuccess(
	projectId: string,
	name: string,
	behind: number | "unknown" | null,
	now: number,
	dormant: RemoteDormantReason | null = null,
): void {
	const record = recordFor(projectId, `${REMOTE_NAME}/${name}`);
	record.behind = behind;
	record.lastCheckedAt = new Date(now).toISOString();
	record.dormant = dormant;
	record.failureCount = 0;
	record.nextRetryAt = null;
	record.lastError = null;
}

async function applyProbe(
	projectId: string,
	repoPath: string,
	names: string[],
	now: number,
): Promise<void> {
	const result = await probeRemoteRefsFn(repoPath, REMOTE_NAME, names, REMOTE_CHECK_TIMEOUT_MS);
	if (!result.ok) {
		markFailure(projectId, names, now, result.err);
		return;
	}
	for (const name of names) {
		const remoteHead = result.heads[name];
		if (remoteHead === undefined) {
			// Absent from an otherwise-successful ls-remote: the upstream branch no longer exists. This is a
			// real, completed finding — never collapsed into a bare `behind: null` with no reason, which a
			// consumer would read as "up to date" (see SPEC.md / RemoteDormantReason's "upstream-gone").
			markSuccess(projectId, name, null, now, "upstream-gone");
			continue;
		}
		const localOid = localTrackingOidFn(repoPath, REMOTE_NAME, name);
		markSuccess(projectId, name, remoteHead === localOid ? null : "unknown", now);
	}
}

/**
 * A moved tracking ref's `RemoteState.behind`, read off the symmetric {@link refDelta} between what this
 * repo last saw for that ref and what the fetch just landed on it.
 *
 * **Only a fast-forward may carry a number.** An upstream can be force-pushed, and "the ref moved" alone
 * says nothing about *which way*:
 * - `ahead === 0` — nothing was dropped, so the move was a genuine fast-forward and `behind` is an honest
 *   count of what landed upstream (`0` here means the ref resolved to the same place after all → `null`,
 *   "up to date", never a numeric `0`).
 * - `ahead > 0, behind === 0` — a pure **rewind**: upstream was force-pushed backward onto a commit we
 *   already have. There is nothing upstream we lack, so this is genuinely "up to date" (`null`) — *not* the
 *   `0` a two-dot count would have produced, which the UI renders as "↓·0 … is 0 commits behind", the
 *   "changed by nothing" lie `RemoteState`'s own contract calls out.
 * - `ahead > 0, behind > 0` — **divergence** (a rebase or amend upstream). Commits really did land, but
 *   history was rewritten underneath them, so a bare "N behind" would describe a fast-forward that never
 *   happened. `"unknown"` is the state that already means "it differs, and a count would misrepresent it";
 *   the UI renders the bare `↓` and offers a fetch.
 * - `null` (the range would not resolve) — differs, count unknowable. Unchanged from before.
 */
function behindFromDelta(
	delta: { ahead: number; behind: number } | null,
): number | "unknown" | null {
	if (!delta) return "unknown";
	if (delta.ahead === 0) return delta.behind === 0 ? null : delta.behind;
	return delta.behind === 0 ? null : "unknown";
}

/**
 * Turns a successful `fetchRemoteRefs` result (`moved`, plus the tracking-ref oids read just before the
 * fetch) into `RemoteState.behind` for exactly the given `names` — shared between the batch-succeeded path
 * and the isolated-survivors retry path in {@link applyFetch}, since both end up with the same shape of
 * result to interpret, just for a different subset of names.
 */
function applyFetchOutcome(
	projectId: string,
	repoPath: string,
	names: string[],
	moved: string[],
	before: Map<string, string | undefined>,
	now: number,
): void {
	for (const name of names) {
		if (!moved.includes(name)) {
			markSuccess(projectId, name, null, now);
			continue;
		}
		const beforeOid = before.get(name);
		if (beforeOid === undefined) {
			// This ref's very first fetch — nothing to count FROM, so nothing to report yet either.
			markSuccess(projectId, name, null, now);
			continue;
		}
		const delta = refDeltaFn(repoPath, beforeOid, `refs/remotes/${REMOTE_NAME}/${name}`);
		markSuccess(projectId, name, behindFromDelta(delta), now);
	}
}

async function applyFetch(
	projectId: string,
	repoPath: string,
	names: string[],
	now: number,
): Promise<void> {
	// Snapshotted BEFORE the fetch: the fetch itself moves the local tracking ref, so this is the only
	// chance to read what it was "before" — see SPEC.md's "Design notes" for why this, not an arbitrary
	// workspace's HEAD, is the count's other endpoint. Shared across the batch attempt AND (on failure) the
	// isolated survivors retry below, since both describe the same round's "before" state.
	const before = new Map(
		names.map((name) => [name, localTrackingOidFn(repoPath, REMOTE_NAME, name)]),
	);

	const result = await fetchRemoteRefsFn(repoPath, REMOTE_NAME, names, REMOTE_CHECK_TIMEOUT_MS);
	if (result.ok) {
		applyFetchOutcome(projectId, repoPath, names, result.moved, before, now);
		return;
	}

	// `fetchRemoteRefsArgv` names every ref explicitly, so ONE deleted upstream branch makes the WHOLE `git
	// fetch` invocation exit non-zero (verified empirically — see SPEC.md), even when every other named ref
	// is perfectly fetchable. Isolate before blaming every ref: a batched `ls-remote` never fails just
	// because one requested name is absent (see `applyProbe`'s own absent-name handling above), so it can
	// safely tell us which names still exist without risking the same poisoning.
	const classify = await probeRemoteRefsFn(repoPath, REMOTE_NAME, names, REMOTE_CHECK_TIMEOUT_MS);
	if (!classify.ok) {
		// The remote itself is unreachable — a genuine transient/network failure, not any one ref's
		// problem. Every ref stays (or becomes) "failing", never "gone" on a guess. The classifying probe's
		// stderr (not the original fetch's) is what's stored: it is the call that actually diagnosed the
		// remote as unreachable, and it ran second, so it is the more current answer.
		markFailure(projectId, names, now, classify.err);
		return;
	}
	const gone = names.filter((name) => classify.heads[name] === undefined);
	const survivors = names.filter((name) => classify.heads[name] !== undefined);
	for (const name of gone) markSuccess(projectId, name, null, now, "upstream-gone");
	if (survivors.length === 0) return;

	const retry = await fetchRemoteRefsFn(repoPath, REMOTE_NAME, survivors, REMOTE_CHECK_TIMEOUT_MS);
	if (!retry.ok) {
		markFailure(projectId, survivors, now, retry.err);
		return;
	}
	applyFetchOutcome(projectId, repoPath, survivors, retry.moved, before, now);
}

// ── the real CheckProjectFn ────────────────────────────────────────────────

function stateFromRecord(projectId: string, ref: string): RemoteState {
	const record = recordFor(projectId, ref);
	return {
		projectId,
		ref,
		behind: record.behind,
		lastCheckedAt: record.lastCheckedAt,
		...(record.dormant ? { dormant: record.dormant } : {}),
	};
}

let publish: ((payload: ProjectRemoteStatePayload) => void) | null = null;

/**
 * The `setFsNudgePublisher`-shaped seam (`host/fsNudge.ts`): a module-level nullable function, `null` a
 * silent no-op. `checkProject` calls this once per invocation with the FULL per-project snapshot (every
 * derived ref, matching `ProjectRemoteStatePayload`'s replace-not-merge contract).
 */
export function setRemoteStatePublisher(
	publisher: ((payload: ProjectRemoteStatePayload) => void) | null,
): void {
	publish = publisher;
}

function publishSnapshot(projectId: string, refs: string[]): void {
	publish?.({ projectId, states: refs.map((ref) => stateFromRecord(projectId, ref)) });
}

/**
 * `remoteStateFor(projectId)`: a pure cache READ, never a probe trigger (see SPEC.md's "Get right"). It
 * re-derives the current ref set (cheap — a `loadWorkspaces()` read, the same pattern the mechanics half
 * already uses for `loadProjects()`) and projects each ref's last-computed `PairRecord` onto the wire
 * shape. It never touches `git` or `isRemoteTrusted`; a ref this project has derived but `checkProject` has
 * never yet run for reports `{ behind: null, lastCheckedAt: null }` with no `dormant` field — an honest
 * "not yet known", never a live-recomputed guess.
 */
export function remoteStateFor(projectId: string): RemoteState[] {
	return refsForProject(projectId).map((ref) => stateFromRecord(projectId, ref));
}

/**
 * The real implementation of `CheckProjectFn` (see `remotes.ts`): derive this project's remote-tracking
 * refs, short-circuit the whole project to `dormant: "disabled"` with zero I/O when `gitRemoteCheck` is
 * `"off"`, otherwise walk each ref through the credential ladder, batch the eligible ones into one
 * probe/fetch call, apply the result, and publish the resulting snapshot.
 */
export const checkProject: CheckProjectFn = async (projectId) => {
	const refs = refsForProject(projectId);
	pruneStaleRecords(projectId, refs);
	if (refs.length === 0) {
		publishSnapshot(projectId, refs);
		return;
	}

	const mode: AppConfig["gitRemoteCheck"] = currentGitRemoteCheckMode();
	if (mode === "off") {
		for (const ref of refs) recordFor(projectId, ref).dormant = "disabled";
		publishSnapshot(projectId, refs);
		return;
	}

	const project: Project | undefined = loadProjects().find((p) => p.id === projectId);
	if (!project) {
		publishSnapshot(projectId, refs);
		return;
	}

	const now = nowFn();
	// Both answers are identical for every ref this round (`REMOTE_NAME` is a fixed module constant, and
	// `project` is resolved once above) — memoized lazily, on first actual use, rather than computed
	// unconditionally here: see `ladderReason`'s own doc for why eager hoisting would break the sticky
	// `"upstream-gone"` short-circuit.
	let trustedCache: boolean | undefined;
	const trusted = (): boolean => {
		if (trustedCache === undefined) trustedCache = isRemoteTrusted(projectId, REMOTE_NAME);
		return trustedCache;
	};
	let urlKindCache: ReturnType<typeof remoteUrlKindFn> | undefined;
	const urlKind = (): ReturnType<typeof remoteUrlKindFn> => {
		if (urlKindCache === undefined) urlKindCache = remoteUrlKindFn(project.path, REMOTE_NAME);
		return urlKindCache;
	};

	const toCheck: string[] = [];
	for (const ref of refs) {
		const record = recordFor(projectId, ref);
		const reason = ladderReason(record, now, trusted, urlKind);
		record.dormant = reason;
		if (!reason) toCheck.push(shortNameOf(ref));
	}

	if (toCheck.length > 0) {
		if (mode === "fetch") await applyFetch(projectId, project.path, toCheck, now);
		else await applyProbe(projectId, project.path, toCheck, now);
	}

	publishSnapshot(projectId, refs);
};

// ── fetchRefNow: the user-initiated fetch (git.fetchNow's policy half) ────

/**
 * A user-initiated real fetch of exactly one `(project, ref)` pair — the ComparisonTarget pill's "Fetch"
 * affordance (`git.fetchNow`). Unlike {@link checkProject}, this BYPASSES the credential ladder entirely:
 * it is the one path that performs a real git operation for a pair that has never been trusted (the
 * ladder's `never-authenticated` rung would otherwise gate `checkProject` from ever calling git for it,
 * forever). Recording that trust once this resolves successfully is the HOST's job (`noteRemoteTrusted`,
 * called from the `git.fetchNow` handler after this returns) — not this function's; see the re-export
 * above for why the write side of rung 2 is exposed through this same barrel.
 *
 * Reuses {@link applyFetch} — the same batch-then-classify-then-retry recovery `checkProject`'s fetch mode
 * uses, degenerate here at a batch of one — so a vanished upstream branch resolves as `dormant:
 * "upstream-gone"`, never mis-attributed to "failing": the exact bug class Task 5b's review fixed for the
 * scheduler. A hand-rolled single-ref fetch here would silently reintroduce it. Folds the result into the
 * SAME `PairRecord` `checkProject`/`remoteStateFor` read and write, so a following `git.remoteState` read
 * (or the next scheduled check) is never stale behind what this just resolved, and publishes the project's
 * full snapshot (replace, matching every other publish here) so every OTHER connected client converges too.
 *
 * Throws — never resolves a `RemoteState` — when: `ref` isn't remote-tracking-shaped (nothing to fetch);
 * `projectId` names no known project; or the underlying git operation itself didn't complete (`dormant:
 * "failing"` after `applyFetch`) — a one-shot user action's failure belongs on the error path, not folded
 * silently into a dormancy label the way the background scheduler's is. A discovered-gone ref (`dormant:
 * "upstream-gone"`) is NOT a failure here: the fetch mechanism worked and gave a real, completed answer.
 *
 * The thrown message includes the underlying git stderr (`PairRecord.lastError`, set by `markFailure` from
 * whichever of `applyFetch`'s calls actually diagnosed the failure) — never just "it failed". This backs a
 * button the user just clicked; "auth rejected", "could not resolve host", and "connection refused" are
 * three different next actions for them, and collapsing all three into one generic sentence would erase
 * exactly the distinction the click was trying to get an answer to.
 */
export async function fetchRefNow(projectId: string, ref: string): Promise<RemoteState> {
	if (!isRemoteTrackingRef(ref)) throw new Error(`Not a remote-tracking ref: ${ref}`);
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);

	const name = shortNameOf(ref);
	const now = nowFn();
	await applyFetch(projectId, project.path, [name], now);
	publishSnapshot(projectId, refsForProject(projectId));

	const record = recordFor(projectId, ref);
	if (record.dormant === "failing") {
		throw new Error(`Could not fetch ${ref}: ${record.lastError ?? "unknown error"}`);
	}
	return stateFromRecord(projectId, ref);
}
