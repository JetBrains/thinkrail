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
	behindCount,
	diffBaseRef,
	fetchRemoteRefs,
	git,
	probeRemoteRefs,
	remoteUrlKind,
	sshAgentPresent,
} from "../git";
import { isRemoteTrusted, loadProjects, loadWorkspaces } from "../persistence";
import type { CheckProjectFn } from "./remotes";
import { currentGitRemoteCheckMode } from "./remotes";

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
}

function defaultRecord(): PairRecord {
	return { behind: null, lastCheckedAt: null, dormant: null, failureCount: 0, nextRetryAt: null };
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

function defaultLocalTrackingOid(
	repoPath: string,
	remote: string,
	name: string,
): string | undefined {
	// The same "read this tracking ref's oid" primitive `git/remoteRefs.ts`'s own private `trackingRefOid`
	// is built on, reimplemented here on the already-public sync `git` runner rather than exporting that
	// private helper — see SPEC.md's "Design notes" for why this belongs to the POLICY half's own
	// comparison basis, not a widened `git` module surface.
	const result = git(repoPath, [
		"rev-parse",
		"--verify",
		"--quiet",
		"--end-of-options",
		`refs/remotes/${remote}/${name}`,
	]);
	return result.ok && result.out !== "" ? result.out : undefined;
}

export interface RemoteCheckPolicyDeps {
	probeRemoteRefs?: typeof probeRemoteRefs;
	fetchRemoteRefs?: typeof fetchRemoteRefs;
	behindCount?: typeof behindCount;
	remoteUrlKind?: typeof remoteUrlKind;
	sshAgentPresent?: typeof sshAgentPresent;
	localTrackingOid?: (repoPath: string, remote: string, name: string) => string | undefined;
	now?: () => number;
}

let probeRemoteRefsFn: typeof probeRemoteRefs = probeRemoteRefs;
let fetchRemoteRefsFn: typeof fetchRemoteRefs = fetchRemoteRefs;
let behindCountFn: typeof behindCount = behindCount;
let remoteUrlKindFn: typeof remoteUrlKind = remoteUrlKind;
let sshAgentPresentFn: typeof sshAgentPresent = sshAgentPresent;
let localTrackingOidFn: (repoPath: string, remote: string, name: string) => string | undefined =
	defaultLocalTrackingOid;
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
	behindCountFn = deps.behindCount ?? behindCount;
	remoteUrlKindFn = deps.remoteUrlKind ?? remoteUrlKind;
	sshAgentPresentFn = deps.sshAgentPresent ?? sshAgentPresent;
	localTrackingOidFn = deps.localTrackingOid ?? defaultLocalTrackingOid;
	nowFn = deps.now ?? Date.now;
	pairRecords.clear();
}

// ── the credential ladder (fixed precedence — see SPEC.md) ───────────────

/** Rungs 2-4 of the ladder (rung 1, `"disabled"`, is checked once for the whole project before this is
 * ever called — see {@link checkProject}). `null` means eligible: add this ref to the network batch. */
function ladderReason(
	projectId: string,
	remote: string,
	repoPath: string,
	record: PairRecord,
	now: number,
): RemoteDormantReason | null {
	if (!isRemoteTrusted(projectId, remote)) return "never-authenticated";
	if (remoteUrlKindFn(repoPath, remote) === "ssh" && sshAgentPresentFn())
		return "ssh-agent-present";
	if (record.nextRetryAt !== null && now < record.nextRetryAt) return "failing";
	return null;
}

// ── applying a probe/fetch result ─────────────────────────────────────────

function markFailure(projectId: string, names: string[], now: number): void {
	for (const name of names) {
		const record = recordFor(projectId, `${REMOTE_NAME}/${name}`);
		record.failureCount += 1;
		record.nextRetryAt = now + backoffDelayFor(record.failureCount);
		record.dormant = "failing";
		// behind/lastCheckedAt intentionally untouched: a failed attempt taught us nothing new about
		// either, and RemoteState's own contract says they reflect the last check that actually completed.
	}
}

function markSuccess(
	projectId: string,
	name: string,
	behind: number | "unknown" | null,
	now: number,
): void {
	const record = recordFor(projectId, `${REMOTE_NAME}/${name}`);
	record.behind = behind;
	record.lastCheckedAt = new Date(now).toISOString();
	record.dormant = null;
	record.failureCount = 0;
	record.nextRetryAt = null;
}

async function applyProbe(
	projectId: string,
	repoPath: string,
	names: string[],
	now: number,
): Promise<void> {
	const result = await probeRemoteRefsFn(repoPath, REMOTE_NAME, names, REMOTE_CHECK_TIMEOUT_MS);
	if (!result.ok) {
		markFailure(projectId, names, now);
		return;
	}
	for (const name of names) {
		const remoteHead = result.heads[name];
		// A ref absent from the result (deleted upstream) has no "moved" signal to report — see SPEC.md.
		const localOid =
			remoteHead === undefined ? undefined : localTrackingOidFn(repoPath, REMOTE_NAME, name);
		const behind = remoteHead === undefined || remoteHead === localOid ? null : "unknown";
		markSuccess(projectId, name, behind, now);
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
	// workspace's HEAD, is the count's other endpoint.
	const before = new Map(
		names.map((name) => [name, localTrackingOidFn(repoPath, REMOTE_NAME, name)]),
	);
	const result = await fetchRemoteRefsFn(repoPath, REMOTE_NAME, names, REMOTE_CHECK_TIMEOUT_MS);
	if (!result.ok) {
		markFailure(projectId, names, now);
		return;
	}
	for (const name of names) {
		if (!result.moved.includes(name)) {
			markSuccess(projectId, name, null, now);
			continue;
		}
		const beforeOid = before.get(name);
		if (beforeOid === undefined) {
			// This ref's very first fetch — nothing to count FROM, so nothing to report yet either.
			markSuccess(projectId, name, null, now);
			continue;
		}
		const count = behindCountFn(repoPath, beforeOid, `refs/remotes/${REMOTE_NAME}/${name}`);
		markSuccess(projectId, name, count === null ? "unknown" : count, now);
	}
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
	const toCheck: string[] = [];
	for (const ref of refs) {
		const record = recordFor(projectId, ref);
		const reason = ladderReason(projectId, REMOTE_NAME, project.path, record, now);
		record.dormant = reason;
		if (!reason) toCheck.push(shortNameOf(ref));
	}

	if (toCheck.length > 0) {
		if (mode === "fetch") await applyFetch(projectId, project.path, toCheck, now);
		else await applyProbe(projectId, project.path, toCheck, now);
	}

	publishSnapshot(projectId, refs);
};
