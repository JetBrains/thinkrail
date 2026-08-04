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

/**
 * Fakes for every git-module answer `policy.ts` consumes, plus the clock — installed via
 * `configureRemoteCheckPolicyDeps` (which also resets all in-memory `PairRecord` state, so every test
 * starts from a clean slate regardless of a previous test's project/ref ids). `state.*Result` is mutated
 * by a test to script the next call's answer; `calls.*` records what was actually asked, so a test can
 * assert both the outcome AND that a short-circuited path never made the call at all.
 */
function makeFakes() {
	const state = {
		clock: 1_000_000,
		probeResult: { ok: true, heads: {} as Record<string, string>, err: "" },
		fetchResult: { ok: true, moved: [] as string[], err: "" },
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
			return state.probeResult;
		},
		fetchRemoteRefs: async (repoPath, remote, refs, timeoutMs) => {
			calls.fetch.push({ repoPath, remote, refs, timeoutMs });
			return state.fetchResult;
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

	// BACKOFF_MAX_MS comfortably clears every un-capped delay below it too, so 10 successive real
	// attempts land here — enough consecutive failures (5 * 2**9 = 2560min) to exceed the 24h cap.
	for (let i = 0; i < 10; i++) {
		await checkProject("p1");
		state.clock += BACKOFF_MAX_MS;
	}
	expect(calls.probe).toHaveLength(10);

	// One ms short of the (capped) retry time must still be backed off — if the delay had kept doubling
	// unboundedly instead of capping, this assertion would hold too, so the real proof is the PREVIOUS
	// loop completing 10 attempts using a fixed BACKOFF_MAX_MS stride: an uncapped delay after failure #10
	// (2560min) would have left this call still gated by then as well, but by then far more than
	// BACKOFF_MAX_MS would have been required between attempts #9 and #10 — which the loop already
	// disproved by succeeding with a constant stride.
	state.clock -= 1;
	await checkProject("p1");
	expect(calls.probe).toHaveLength(10); // still gated
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

test("probe mode reports behind: null when the ref no longer exists on the remote", async () => {
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
	expect(s?.dormant).toBeUndefined();
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
