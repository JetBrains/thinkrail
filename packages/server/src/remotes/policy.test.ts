// The remote-check scheduler's POLICY half (see SPEC.md): WHAT `checkProject` does, never WHEN — that's
// `remotes.ts`. Every git/network answer here is FAKED via `configureRemoteCheckPolicyDeps`; no test ever
// spawns real git (Task 3's `git/remoteRefs.test.ts` already covers the raw functions' own behavior) or
// sleeps for the backoff timing (the clock is injected too). This suite is exercising POLICY — the ladder,
// the precedence, the backoff schedule, and the honesty rules for `RemoteState.behind` — never mechanics.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_CONFIG,
	type Project,
	type ProjectRemoteStatePayload,
	type Workspace,
} from "@thinkrail/contracts";
import { noteRemoteTrusted, saveProjects, saveWorkspaces } from "../persistence";
import {
	BACKOFF_BASE_MS,
	BACKOFF_MAX_MS,
	checkProject,
	configureRemoteCheckPolicyDeps,
	fetchRefNow,
	REMOTE_CHECK_TIMEOUT_MS,
	type RemoteCheckPolicyDeps,
	refsForProject,
	remoteStateFor,
	setRemoteStatePublisher,
} from "./policy";
import { configureRemoteChecks } from "./remotes";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-remotes-policy-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	configureRemoteChecks(DEFAULT_CONFIG); // a known "probe" baseline, regardless of test order
});

afterEach(() => {
	setRemoteStatePublisher(null); // never leak a publisher into the next test
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function project(id: string): Project {
	return { id, name: id, path: `/tmp/${id}`, slug: id, lastOpened: 0 };
}

function workspace(
	id: string,
	projectId: string,
	baseBranch: string,
	diffBase?: string,
): Workspace {
	return {
		id,
		projectId,
		name: id,
		branch: id,
		worktreePath: `/tmp/${id}`,
		baseBranch,
		...(diffBase !== undefined ? { diffBase } : {}),
	};
}

type ProbeResult = { ok: boolean; heads: Record<string, string>; err: string };
type FetchResult = { ok: boolean; moved: string[]; err: string };

/**
 * Fakes for every git-module answer `policy.ts` consumes, plus the clock — installed via
 * `configureRemoteCheckPolicyDeps` (which also resets all in-memory `PairRecord` state, so every test
 * starts from a clean slate regardless of a previous test's project/ref ids). `state.*Result` is mutated
 * by a test to script the next call's answer; `calls.*` records what was actually asked, so a test can
 * assert both the outcome AND that a short-circuited path never made the call at all.
 *
 * `probeResult`/`fetchResult` may also be a **function of the requested `refs`** — needed by the
 * fetch-batch-isolation tests, where the batch attempt, the classifying probe, and the survivors-only
 * retry all happen within one `checkProject` call and must each answer differently.
 */
function makeFakes() {
	const state = {
		clock: 1_000_000,
		probeResult: { ok: true, heads: {} as Record<string, string>, err: "" } as
			| ProbeResult
			| ((refs: string[]) => ProbeResult),
		fetchResult: { ok: true, moved: [] as string[], err: "" } as
			| FetchResult
			| ((refs: string[]) => FetchResult),
		behindCountResult: null as number | null,
		remoteUrlKindResult: "other" as "ssh" | "other" | "unknown",
		sshAgentPresentResult: false,
		/** Keyed `${remote}/${name}`, e.g. `"origin/main"` — `undefined` = no local tracking ref exists yet. */
		localTrackingOid: {} as Record<string, string | undefined>,
	};
	const calls = {
		probe: [] as { repoPath: string; remote: string; refs: string[]; timeoutMs: number }[],
		fetch: [] as { repoPath: string; remote: string; refs: string[]; timeoutMs: number }[],
		behindCount: [] as { repoPath: string; from: string; to: string }[],
		remoteUrlKind: [] as { repoPath: string; remote: string }[],
		sshAgentPresent: 0,
		localTrackingOid: [] as { repoPath: string; remote: string; name: string }[],
	};
	const deps: RemoteCheckPolicyDeps = {
		probeRemoteRefs: async (repoPath, remote, refs, timeoutMs) => {
			calls.probe.push({ repoPath, remote, refs, timeoutMs });
			return typeof state.probeResult === "function" ? state.probeResult(refs) : state.probeResult;
		},
		fetchRemoteRefs: async (repoPath, remote, refs, timeoutMs) => {
			calls.fetch.push({ repoPath, remote, refs, timeoutMs });
			return typeof state.fetchResult === "function" ? state.fetchResult(refs) : state.fetchResult;
		},
		behindCount: (repoPath, from, to) => {
			calls.behindCount.push({ repoPath, from, to });
			return state.behindCountResult;
		},
		remoteUrlKind: (repoPath, remote) => {
			calls.remoteUrlKind.push({ repoPath, remote });
			return state.remoteUrlKindResult;
		},
		sshAgentPresent: () => {
			calls.sshAgentPresent++;
			return state.sshAgentPresentResult;
		},
		localTrackingOid: (repoPath, remote, name) => {
			calls.localTrackingOid.push({ repoPath, remote, name });
			return state.localTrackingOid[`${remote}/${name}`];
		},
		now: () => state.clock,
	};
	return { state, calls, deps };
}

// ── ref derivation ───────────────────────────────────────────────────────

test("derives the distinct remote-tracking refs across a project's workspaces, dropping local bases and duplicates", () => {
	saveProjects([project("p1"), project("p2")]);
	saveWorkspaces([
		workspace("w1", "p1", "origin/main"),
		workspace("w2", "p1", "origin/main", "origin/main"), // resolves to the same ref — a duplicate
		workspace("w3", "p1", "origin/develop"),
		workspace("w4", "p1", "feature/local"), // not remote-tracking — dropped
		workspace("w5", "p2", "origin/main"), // a different project — must not leak into p1's set
	]);

	expect(refsForProject("p1").sort()).toEqual(["origin/develop", "origin/main"]);
	expect(refsForProject("p2")).toEqual(["origin/main"]);
});

test("a project with no workspaces (or none with a remote-tracking base) has no refs", () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "feature/local")]);
	expect(refsForProject("p1")).toEqual([]);
});

// ── dormancy: disabled ───────────────────────────────────────────────────

test("the 'off' mode reports dormant: disabled for every derived ref, with no network or git I/O at all", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "off" });
	const { deps, calls } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);
	// Trust is deliberately never granted, and the remote is never classified as ssh — proving "disabled"
	// wins without even reaching those checks, not merely that it CAN'T be reached here.

	await checkProject("p1");

	expect(remoteStateFor("p1")).toEqual([
		{ projectId: "p1", ref: "origin/main", behind: null, lastCheckedAt: null, dormant: "disabled" },
	]);
	expect(calls.probe).toEqual([]);
	expect(calls.fetch).toEqual([]);
	expect(calls.remoteUrlKind).toEqual([]);
	expect(calls.sshAgentPresent).toBe(0);
	expect(calls.localTrackingOid).toEqual([]);
});

// ── dormancy: never-authenticated ────────────────────────────────────────

test("an untrusted remote is dormant with never-authenticated and is never probed", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	const { deps, calls } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);
	// Trust deliberately never granted via noteRemoteTrusted.

	await checkProject("p1");

	expect(remoteStateFor("p1")).toEqual([
		{
			projectId: "p1",
			ref: "origin/main",
			behind: null,
			lastCheckedAt: null,
			dormant: "never-authenticated",
		},
	]);
	expect(calls.probe).toEqual([]);
	expect(calls.remoteUrlKind).toEqual([]); // short-circuited before even asking
});

// ── dormancy: ssh-agent-present ───────────────────────────────────────────

test("a trusted SSH remote with an agent present is dormant with ssh-agent-present, and is never probed", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, calls, state } = makeFakes();
	state.remoteUrlKindResult = "ssh";
	state.sshAgentPresentResult = true;
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(remoteStateFor("p1")).toEqual([
		{
			projectId: "p1",
			ref: "origin/main",
			behind: null,
			lastCheckedAt: null,
			dormant: "ssh-agent-present",
		},
	]);
	expect(calls.probe).toEqual([]);
	expect(calls.remoteUrlKind.length).toBeGreaterThan(0);
});

test("a trusted non-SSH remote is never dormant with ssh-agent-present even when an agent is present", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.remoteUrlKindResult = "other";
	state.sshAgentPresentResult = true; // an agent IS present, but the remote isn't ssh — irrelevant
	// Present on the remote (this test is about the ssh-agent rung, not upstream-gone) — any oid will do.
	state.probeResult = { ok: true, heads: { main: "irrelevant-oid" }, err: "" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.dormant).toBeUndefined();
});

// ── dormancy precedence (a pair can qualify for several reasons at once) ─

test("dormancy precedence: disabled beats every other reason", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "off" });
	const { deps } = makeFakes(); // untrusted by default — never-authenticated would otherwise apply
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.dormant).toBe("disabled");
});

test("dormancy precedence: never-authenticated beats ssh-agent-present (short-circuits before remoteUrlKind is called)", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	const { deps, calls, state } = makeFakes();
	state.remoteUrlKindResult = "ssh";
	state.sshAgentPresentResult = true;
	configureRemoteCheckPolicyDeps(deps);
	// Trust deliberately never granted.

	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.dormant).toBe("never-authenticated");
	expect(calls.remoteUrlKind).toEqual([]); // never even asked — proving the short-circuit, not just the label
});

test("dormancy precedence: ssh-agent-present beats a pre-existing failing backoff", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.probeResult = { ok: false, heads: {}, err: "unreachable" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1"); // fails while trusted + non-ssh → backoff activates
	expect(remoteStateFor("p1")[0]?.dormant).toBe("failing");

	// Still within the backoff window, the remote turns out to be ssh + agent-present.
	state.remoteUrlKindResult = "ssh";
	state.sshAgentPresentResult = true;
	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.dormant).toBe("ssh-agent-present");
});

// ── per-pair exponential backoff ─────────────────────────────────────────

test("repeated failure backs off exponentially and reports dormant: failing while backed off", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, calls, state } = makeFakes();
	state.probeResult = { ok: false, heads: {}, err: "unreachable" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1"); // failure #1
	expect(calls.probe).toHaveLength(1);
	expect(remoteStateFor("p1")[0]?.dormant).toBe("failing");

	state.clock += BACKOFF_BASE_MS - 1; // just short of the first backoff elapsing
	await checkProject("p1");
	expect(calls.probe).toHaveLength(1); // still backed off — no new attempt

	state.clock += 1; // exactly elapsed
	await checkProject("p1"); // failure #2 — the delay doubles from here
	expect(calls.probe).toHaveLength(2);

	state.clock += BACKOFF_BASE_MS * 2 - 1; // just short of the doubled delay
	await checkProject("p1");
	expect(calls.probe).toHaveLength(2); // still backed off

	state.clock += 1;
	await checkProject("p1"); // failure #3
	expect(calls.probe).toHaveLength(3);
});

test("backoff is capped at BACKOFF_MAX_MS after enough consecutive failures", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, calls, state } = makeFakes();
	state.probeResult = { ok: false, heads: {}, err: "unreachable" };
	configureRemoteCheckPolicyDeps(deps);

	// Ten consecutive failures, spaced by exactly BACKOFF_MAX_MS each time. Every UNCAPPED delay below the
	// 10th failure (the largest is after failure #9: 5 * 2**8 = 1280min) is comfortably under BACKOFF_MAX_MS
	// (1440min), so all ten attempts fire regardless of whether the cap exists — this loop by itself would
	// still pass with `Math.min(..., BACKOFF_MAX_MS)` deleted from `backoffDelayFor`. The discriminating
	// assertion is the one after the loop, not this one.
	for (let i = 0; i < 10; i++) {
		await checkProject("p1");
		state.clock += BACKOFF_MAX_MS;
	}
	expect(calls.probe).toHaveLength(10);
	// The clock now sits exactly BACKOFF_MAX_MS past failure #10's timestamp (the loop's last increment).

	state.clock -= 1; // one ms short of that
	await checkProject("p1");
	expect(calls.probe).toHaveLength(10); // still gated — boundary is exclusive, not inclusive

	// Restore the clock to exactly BACKOFF_MAX_MS elapsed since failure #10. Capped, `backoffDelayFor(10)`
	// is exactly BACKOFF_MAX_MS, so this attempt is due. Uncapped, it would be 5 * 2**9 = 2560min — more
	// than twice what has elapsed here — and this attempt would stay gated instead. Verified by hand:
	// removing `Math.min(..., BACKOFF_MAX_MS)` from `backoffDelayFor` turns this into a failing assertion
	// (calls.probe stays at 10).
	state.clock += 1;
	await checkProject("p1");
	expect(calls.probe).toHaveLength(11);
});

test("a later success clears the backoff quietly and behind reflects the new result", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.probeResult = { ok: false, heads: {}, err: "unreachable" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1"); // failure → backoff active
	expect(remoteStateFor("p1")[0]?.dormant).toBe("failing");

	state.clock += BACKOFF_BASE_MS; // backoff elapsed
	state.probeResult = { ok: true, heads: { main: "same-oid" }, err: "" };
	state.localTrackingOid["origin/main"] = "same-oid"; // matches → up to date
	await checkProject("p1");

	const [remoteState] = remoteStateFor("p1");
	expect(remoteState?.dormant).toBeUndefined();
	expect(remoteState?.behind).toBeNull();
	expect(typeof remoteState?.lastCheckedAt).toBe("string");
});

test("a failed attempt never overwrites the last successfully-known behind/lastCheckedAt", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.localTrackingOid["origin/main"] = "local";
	state.probeResult = { ok: true, heads: { main: "remote" }, err: "" }; // differs → "unknown"
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");
	const [afterSuccess] = remoteStateFor("p1");
	expect(afterSuccess?.behind).toBe("unknown");
	const checkedAt = afterSuccess?.lastCheckedAt;
	expect(typeof checkedAt).toBe("string");

	state.clock += 1_000;
	state.probeResult = { ok: false, heads: {}, err: "unreachable" };
	await checkProject("p1");

	const [afterFailure] = remoteStateFor("p1");
	expect(afterFailure?.dormant).toBe("failing");
	expect(afterFailure?.behind).toBe("unknown"); // unchanged — the failed attempt taught us nothing new
	expect(afterFailure?.lastCheckedAt).toBe(checkedAt); // unchanged too
});

// ── RemoteState honesty: probe mode ──────────────────────────────────────

test("probe mode reports behind: 'unknown' when the ref differs from the local tracking ref", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.localTrackingOid["origin/main"] = "local-oid";
	state.probeResult = { ok: true, heads: { main: "remote-oid" }, err: "" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	const [s] = remoteStateFor("p1");
	expect(s?.behind).toBe("unknown");
	expect(s?.dormant).toBeUndefined();
});

test("probe mode reports behind: null when the ref matches the local tracking ref", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.localTrackingOid["origin/main"] = "same-oid";
	state.probeResult = { ok: true, heads: { main: "same-oid" }, err: "" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.behind).toBeNull();
});

test("probe mode reports dormant: upstream-gone (and behind: null, never a bare unreasoned null) when the ref no longer exists on the remote", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.localTrackingOid["origin/main"] = "local-oid";
	state.probeResult = { ok: true, heads: {}, err: "" }; // "main" absent — deleted upstream
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	const [s] = remoteStateFor("p1");
	expect(s?.behind).toBeNull();
	expect(s?.dormant).toBe("upstream-gone");
});

// ── RemoteState honesty: fetch mode ──────────────────────────────────────

test("fetch mode reports the exact behind count when the ref moved", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "fetch" });
	const { deps, state, calls } = makeFakes();
	state.localTrackingOid["origin/main"] = "before-oid";
	state.fetchResult = { ok: true, moved: ["main"], err: "" };
	state.behindCountResult = 4;
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.behind).toBe(4);
	expect(calls.behindCount).toEqual([
		{ repoPath: "/tmp/p1", from: "before-oid", to: "refs/remotes/origin/main" },
	]);
});

test("fetch mode reports behind: null when the ref didn't move, without ever calling behindCount", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "fetch" });
	const { deps, state, calls } = makeFakes();
	state.localTrackingOid["origin/main"] = "steady-oid";
	state.fetchResult = { ok: true, moved: [], err: "" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.behind).toBeNull();
	expect(calls.behindCount).toEqual([]);
});

test("fetch mode reports behind: 'unknown' when behindCount can't resolve the range (never 0)", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "fetch" });
	const { deps, state } = makeFakes();
	state.localTrackingOid["origin/main"] = "before-oid";
	state.fetchResult = { ok: true, moved: ["main"], err: "" };
	state.behindCountResult = null;
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.behind).toBe("unknown");
});

test("fetch mode reports behind: null on a ref's very first fetch, with no prior local tracking ref", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "fetch" });
	const { deps, state, calls } = makeFakes();
	// state.localTrackingOid["origin/main"] deliberately left unset — no prior tracking ref exists.
	state.fetchResult = { ok: true, moved: ["main"], err: "" }; // first appearance counts as "moved"
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.behind).toBeNull();
	expect(calls.behindCount).toEqual([]); // no baseline to count from
});

// ── RemoteState honesty: fetch-batch isolation ────────────────────────────
//
// `fetchRemoteRefsArgv` names every ref explicitly, so ONE deleted upstream branch makes the WHOLE `git
// fetch` invocation exit non-zero — verified empirically against real git — even when every other named
// ref is perfectly fetchable. These tests pin `applyFetch`'s batch-then-isolate recovery: a failed batch
// fetch is followed by a classifying `ls-remote` (which never fails just because one name is absent) to
// tell gone names apart from survivors, then a survivors-only retry.

test("fetch mode isolates a batch failure: one vanished ref doesn't poison its healthy sibling", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main"), workspace("w2", "p1", "origin/feature-x")]);
	noteRemoteTrusted("p1", "origin");
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "fetch" });
	const { deps, calls, state } = makeFakes();
	state.localTrackingOid["origin/main"] = "before-oid";
	// The batch fetch (both names) fails outright — `git fetch origin main feature-x` exits 128 for the
	// WHOLE invocation because `feature-x` no longer exists upstream, even though `main` is perfectly
	// fetchable.
	state.fetchResult = (refs) =>
		refs.length === 2
			? { ok: false, moved: [], err: "fatal: couldn't find remote ref feature-x" }
			: { ok: true, moved: ["main"], err: "" };
	// The classifying ls-remote never fails just because one name is absent: main present, feature-x gone.
	state.probeResult = { ok: true, heads: { main: "after-oid" }, err: "" };
	state.behindCountResult = 2;
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	const states = remoteStateFor("p1");
	const main = states.find((s) => s.ref === "origin/main");
	const feature = states.find((s) => s.ref === "origin/feature-x");
	expect(main?.dormant).toBeUndefined();
	expect(main?.behind).toBe(2);
	expect(feature?.dormant).toBe("upstream-gone");
	expect(feature?.behind).toBeNull();

	// The call sequence proves isolation, not just the outcome: one failed batch fetch (both names), one
	// classifying probe (both names), one retry fetch naming ONLY the survivor.
	expect(calls.fetch).toHaveLength(2);
	expect(calls.fetch[0]?.refs.sort()).toEqual(["feature-x", "main"]);
	expect(calls.fetch[1]?.refs).toEqual(["main"]);
	expect(calls.probe).toHaveLength(1);
	expect(calls.probe[0]?.refs.sort()).toEqual(["feature-x", "main"]);
});

test("fetch mode: if the classifying probe ALSO fails, every ref is marked failing — never guessed gone", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main"), workspace("w2", "p1", "origin/feature-x")]);
	noteRemoteTrusted("p1", "origin");
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "fetch" });
	const { deps, calls, state } = makeFakes();
	state.fetchResult = { ok: false, moved: [], err: "fatal: unable to access remote" };
	// A genuinely unreachable remote: the classifying ls-remote fails too, not just the fetch.
	state.probeResult = { ok: false, heads: {}, err: "fatal: unable to access remote" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	for (const s of remoteStateFor("p1")) expect(s.dormant).toBe("failing");
	expect(calls.fetch).toHaveLength(1); // batch attempt only — a failed classify rules out a retry
	expect(calls.probe).toHaveLength(1); // the classifying attempt
});

test("fetch mode: when every name in the batch turns out gone, no survivors retry is attempted", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "fetch" });
	const { deps, calls, state } = makeFakes();
	state.fetchResult = { ok: false, moved: [], err: "fatal: couldn't find remote ref main" };
	state.probeResult = { ok: true, heads: {}, err: "" }; // "main" absent from the classifying probe too
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.dormant).toBe("upstream-gone");
	expect(calls.fetch).toHaveLength(1); // batch attempt only — no survivors left to retry
	expect(calls.probe).toHaveLength(1);
});

// ── dormancy precedence: upstream-gone ────────────────────────────────────

test("dormancy precedence: disabled beats a sticky upstream-gone", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.probeResult = { ok: true, heads: {}, err: "" }; // "main" absent — discovered gone
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");
	expect(remoteStateFor("p1")[0]?.dormant).toBe("upstream-gone");

	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "off" });
	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.dormant).toBe("disabled");
});

test("dormancy precedence: a sticky upstream-gone short-circuits the ladder — never re-consulted even once agent-present would otherwise apply", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, calls, state } = makeFakes();
	state.probeResult = { ok: true, heads: {}, err: "" }; // "main" absent — discovered gone
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");
	expect(remoteStateFor("p1")[0]?.dormant).toBe("upstream-gone");
	expect(calls.probe).toHaveLength(1);
	// Round 1 legitimately consults remoteUrlKind once (ladderReason's ssh check runs before the probe
	// discovers the ref is gone) — snapshot that count so round 2's "no NEW call" check isn't fooled by it.
	const remoteUrlKindCallsAfterRound1 = calls.remoteUrlKind.length;

	// If the ladder were re-consulted from scratch, this would now report ssh-agent-present instead.
	state.remoteUrlKindResult = "ssh";
	state.sshAgentPresentResult = true;
	await checkProject("p1");

	expect(remoteStateFor("p1")[0]?.dormant).toBe("upstream-gone"); // unchanged
	expect(calls.remoteUrlKind).toHaveLength(remoteUrlKindCallsAfterRound1); // no NEW call — short-circuited
	expect(calls.probe).toHaveLength(1); // no new network call either — the pair stays fully excluded
});

// ── pairRecords pruning ────────────────────────────────────────────────────

test("a ref no longer derived is forgotten, so re-deriving it later starts fresh rather than resuming a stale backoff", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.probeResult = { ok: false, heads: {}, err: "unreachable" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1"); // origin/main fails, backed off for BACKOFF_BASE_MS (well into the future)
	expect(remoteStateFor("p1")[0]?.dormant).toBe("failing");

	// The workspace re-points away from origin/main entirely — its old record must not linger.
	saveWorkspaces([workspace("w1", "p1", "origin/other")]);
	state.probeResult = { ok: true, heads: { other: "same" }, err: "" };
	state.localTrackingOid["origin/other"] = "same";
	await checkProject("p1"); // prunes origin/main's record; origin/other succeeds cleanly

	// Re-point back to origin/main, still well within what would have been the old backoff window (the
	// clock never advanced).
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	state.probeResult = { ok: true, heads: { main: "same-main" }, err: "" };
	state.localTrackingOid["origin/main"] = "same-main";
	await checkProject("p1");

	// If the old PairRecord had survived, its nextRetryAt (still in the future) would have gated this
	// exact call and reported dormant: "failing" again despite the healthy probe result just given.
	const [s] = remoteStateFor("p1");
	expect(s?.dormant).toBeUndefined();
	expect(s?.behind).toBeNull();
});

// ── publisher ─────────────────────────────────────────────────────────────

test("publishes a full per-project snapshot after checkProject runs", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, state } = makeFakes();
	state.localTrackingOid["origin/main"] = "same";
	state.probeResult = { ok: true, heads: { main: "same" }, err: "" };
	configureRemoteCheckPolicyDeps(deps);

	const published: ProjectRemoteStatePayload[] = [];
	setRemoteStatePublisher((payload) => published.push(payload));

	await checkProject("p1");

	expect(published).toHaveLength(1);
	expect(published[0]).toEqual({ projectId: "p1", states: remoteStateFor("p1") });
});

test("a null publisher is a silent no-op", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	const { deps } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);
	setRemoteStatePublisher(null);

	await checkProject("p1"); // must not throw
});

// ── remoteStateFor: a pure cache read, never a probe trigger ─────────────

test("remoteStateFor reports a not-yet-known pair before any check has run, even while the mode is off", () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	configureRemoteChecks({ ...DEFAULT_CONFIG, gitRemoteCheck: "off" });
	const { deps } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);

	expect(remoteStateFor("p1")).toEqual([
		{ projectId: "p1", ref: "origin/main", behind: null, lastCheckedAt: null },
	]);
});

test("remoteStateFor never calls any injected git function", () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	const { deps, calls } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);

	remoteStateFor("p1");

	expect(calls.probe).toEqual([]);
	expect(calls.fetch).toEqual([]);
	expect(calls.behindCount).toEqual([]);
	expect(calls.remoteUrlKind).toEqual([]);
	expect(calls.sshAgentPresent).toBe(0);
	expect(calls.localTrackingOid).toEqual([]);
});

// ── batching + misc robustness ────────────────────────────────────────────

test("checkProject batches every derived ref into one probe call per project", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main"), workspace("w2", "p1", "origin/develop")]);
	noteRemoteTrusted("p1", "origin");
	const { deps, calls, state } = makeFakes();
	state.probeResult = { ok: true, heads: { main: "a", develop: "b" }, err: "" };
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("p1");

	expect(calls.probe).toHaveLength(1);
	expect(calls.probe[0]?.refs.sort()).toEqual(["develop", "main"]);
	expect(calls.probe[0]?.timeoutMs).toBe(REMOTE_CHECK_TIMEOUT_MS);
});

test("a project with no remote-tracking refs does nothing and publishes an empty snapshot", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "feature/local")]);
	const { deps, calls } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);
	const published: ProjectRemoteStatePayload[] = [];
	setRemoteStatePublisher((payload) => published.push(payload));

	await checkProject("p1");

	expect(published).toEqual([{ projectId: "p1", states: [] }]);
	expect(calls.probe).toEqual([]);
});

test("checkProject for a project id with no matching Project record degrades quietly, without throwing", async () => {
	saveWorkspaces([workspace("w1", "ghost", "origin/main")]);
	const { deps } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);

	await checkProject("ghost"); // refsForProject("ghost") is non-empty, but loadProjects() has no match
});

// ── fetchRefNow: the user-initiated fetch, bypassing the credential ladder ──
//
// `git.fetchNow`'s policy half. Unlike checkProject, there is no "off" short-circuit and no ladder
// consultation at all — a caller reaches this specifically BECAUSE the pair hasn't been trusted yet
// (`noteRemoteTrusted` is the host's job, called only after this resolves), so gating it on
// `isRemoteTrusted` would make the bootstrap path impossible to ever complete.

test("performs a real fetch for exactly the given ref, folds the result into the same record remoteStateFor reads, and returns it", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	// Trust deliberately never granted — fetchRefNow must not consult the ladder at all.
	const { deps, state, calls } = makeFakes();
	state.localTrackingOid["origin/main"] = "before-oid";
	state.fetchResult = { ok: true, moved: ["main"], err: "" };
	state.behindCountResult = 3;
	configureRemoteCheckPolicyDeps(deps);

	const result = await fetchRefNow("p1", "origin/main");

	expect(result).toEqual({
		projectId: "p1",
		ref: "origin/main",
		behind: 3,
		lastCheckedAt: expect.any(String),
	});
	expect(remoteStateFor("p1")).toEqual([result]); // the scheduler's own cache read agrees immediately
	expect(calls.fetch).toEqual([
		{ repoPath: "/tmp/p1", remote: "origin", refs: ["main"], timeoutMs: REMOTE_CHECK_TIMEOUT_MS },
	]);
});

test("never consults the credential ladder — succeeds even though the pair has never been trusted", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	const { deps, calls } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);

	await fetchRefNow("p1", "origin/main");

	expect(calls.remoteUrlKind).toEqual([]);
	expect(calls.sshAgentPresent).toBe(0);
});

test("publishes the project's full snapshot on success, matching every other publish here", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main"), workspace("w2", "p1", "origin/develop")]);
	const { deps } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);
	const published: ProjectRemoteStatePayload[] = [];
	setRemoteStatePublisher((payload) => published.push(payload));

	await fetchRefNow("p1", "origin/main");

	expect(published).toHaveLength(1);
	expect(published[0]).toEqual({ projectId: "p1", states: remoteStateFor("p1") });
});

test("a discovered-gone ref resolves dormant: upstream-gone rather than throwing — the fetch mechanism worked", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	const { deps, state } = makeFakes();
	state.fetchResult = { ok: false, moved: [], err: "fatal: couldn't find remote ref main" };
	state.probeResult = { ok: true, heads: {}, err: "" }; // classifying ls-remote: main is genuinely absent
	configureRemoteCheckPolicyDeps(deps);

	const result = await fetchRefNow("p1", "origin/main");

	expect(result).toEqual({
		projectId: "p1",
		ref: "origin/main",
		behind: null,
		lastCheckedAt: expect.any(String),
		dormant: "upstream-gone",
	});
});

test("throws when the underlying fetch genuinely fails, even after the classifying isolation", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "origin/main")]);
	const { deps, state } = makeFakes();
	state.fetchResult = { ok: false, moved: [], err: "fatal: unable to access remote" };
	state.probeResult = { ok: false, heads: {}, err: "fatal: unable to access remote" }; // remote unreachable
	configureRemoteCheckPolicyDeps(deps);

	await expect(fetchRefNow("p1", "origin/main")).rejects.toThrow();
});

test("rejects a ref that isn't remote-tracking-shaped, before making any git call at all", async () => {
	saveProjects([project("p1")]);
	saveWorkspaces([workspace("w1", "p1", "feature/local")]);
	const { deps, calls } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);

	await expect(fetchRefNow("p1", "feature/local")).rejects.toThrow();
	expect(calls.fetch).toEqual([]);
	expect(calls.probe).toEqual([]);
});

test("rejects an unknown project id, before making any git call at all", async () => {
	saveWorkspaces([workspace("w1", "ghost", "origin/main")]);
	const { deps, calls } = makeFakes();
	configureRemoteCheckPolicyDeps(deps);

	await expect(fetchRefNow("ghost", "origin/main")).rejects.toThrow();
	expect(calls.fetch).toEqual([]);
});
