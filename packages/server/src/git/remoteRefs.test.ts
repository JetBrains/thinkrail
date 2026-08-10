import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./gitExec";
import {
	fetchRemoteRefs,
	fetchRemoteRefsArgv,
	probeRemoteRefs,
	probeRemoteRefsArgv,
	refDelta,
	remoteUrlKind,
	sshAgentPresent,
} from "./remoteRefs";

let dataDir: string;
const savedSshAuthSock = process.env.SSH_AUTH_SOCK;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-remoteRefs-test-"));
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedSshAuthSock === undefined) delete process.env.SSH_AUTH_SOCK;
	else process.env.SSH_AUTH_SOCK = savedSshAuthSock;
});

/** Throwing fixture-setup wrapper around the real (non-throwing) `git()` runner — failures during setup
 * should blow up loudly rather than leave a half-built fixture that fails a later assertion mysteriously. */
function run(cwd: string, args: string[]): string {
	const result = git(cwd, args);
	if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.err}`);
	return result.out;
}

/**
 * Every `*.lock` file anywhere under `.git`, sorted. A direct recursive filesystem scan — NOT `git
 * ls-files`, which unconditionally excludes `.git` from any working-tree scan and so would report "no
 * locks" even with a real lock file sitting right there (verified directly: creating
 * `.git/refs/remotes/origin/FAKE.lock` by hand and re-running `ls-files --others -- .git/*.lock` still
 * returns nothing).
 */
function lockFilesUnder(gitDir: string): string[] {
	return (readdirSync(gitDir, { recursive: true }) as string[])
		.filter((entry) => entry.endsWith(".lock"))
		.sort();
}

/**
 * A bare remote + a working repo whose `origin` already has `refs/remotes/origin/main` recorded (a push
 * opportunistically updates the local tracking ref for a branch matching `remote add`'s default fetch
 * refspec — verified empirically), so `refDelta` has something to compare against from the start. Plus
 * a `pushAnotherCommit()` closure that commits in a throwaway clone and pushes, returning the new sha.
 * Everything is a plain filesystem path (`file://`-equivalent, no scheme even) — no test here may need
 * internet access.
 */
function seedRepoWithRemote(): { repo: string; remote: string; pushAnotherCommit: () => string } {
	const remote = join(dataDir, "remote.git");
	run(dataDir, ["init", "--bare", "-b", "main", remote]);

	const repo = join(dataDir, "repo");
	mkdirSync(repo);
	run(repo, ["init", "-b", "main"]);
	run(repo, ["config", "user.email", "t@thinkrail.test"]);
	run(repo, ["config", "user.name", "test"]);
	writeFileSync(join(repo, "README.md"), "# repo\n");
	run(repo, ["add", "-A"]);
	run(repo, ["commit", "-m", "init"]);
	run(repo, ["remote", "add", "origin", remote]);
	run(repo, ["push", "origin", "main"]);

	let pushCount = 0;
	const pushAnotherCommit = (): string => {
		pushCount += 1;
		const clone = join(dataDir, `push-${pushCount}`);
		run(dataDir, ["clone", "-q", remote, clone]);
		run(clone, ["config", "user.email", "t@thinkrail.test"]);
		run(clone, ["config", "user.name", "test"]);
		writeFileSync(join(clone, `extra-${pushCount}.txt`), "more\n");
		run(clone, ["add", "-A"]);
		run(clone, ["commit", "-m", `extra ${pushCount}`]);
		run(clone, ["push", "origin", "main"]);
		return run(clone, ["rev-parse", "main"]);
	};

	return { repo, remote, pushAnotherCommit };
}

test("probeRemoteRefsArgv: no-auto-maintenance, --heads, --end-of-options before remote/refs, no trailing --", () => {
	expect(probeRemoteRefsArgv("origin", ["main", "feature/x"])).toEqual([
		"-c",
		"maintenance.auto=false",
		"-c",
		"gc.auto=0",
		"ls-remote",
		"--heads",
		"--end-of-options",
		"origin",
		"main",
		"feature/x",
	]);
});

test("fetchRemoteRefsArgv: no-auto-maintenance, --end-of-options before remote/refs, and NEVER --prune or --tags", () => {
	const argv = fetchRemoteRefsArgv("origin", ["main", "feature/x"]);
	expect(argv).toEqual([
		"-c",
		"maintenance.auto=false",
		"-c",
		"gc.auto=0",
		"fetch",
		"--end-of-options",
		"origin",
		"main",
		"feature/x",
	]);
	// A fetch that only ever names explicit refs gives `--prune` almost no observable scope to bite (see the
	// module's docstring) — asserted directly on the argv rather than trusted to a behavioral side effect
	// that could pass for the wrong reason.
	expect(argv).not.toContain("--prune");
	expect(argv).not.toContain("--tags");
});

test("probeRemoteRefs reports the remote's head and writes nothing locally", async () => {
	const { repo } = seedRepoWithRemote();
	// Snapshot everything a fetch would touch, so "writes nothing" is asserted, not assumed.
	const gitDir = join(repo, ".git");
	const before = {
		remoteRefs: git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"])
			.out,
		fetchHead: existsSync(join(gitDir, "FETCH_HEAD")),
		locks: lockFilesUnder(gitDir),
	};

	const result = await probeRemoteRefs(repo, "origin", ["main"], 10_000);
	expect(result.ok).toBe(true);
	expect(result.heads.main).toMatch(/^[0-9a-f]{40}$/);

	const after = {
		remoteRefs: git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"])
			.out,
		fetchHead: existsSync(join(gitDir, "FETCH_HEAD")),
		locks: lockFilesUnder(gitDir),
	};
	expect(after).toEqual(before);
});

test("probeRemoteRefs sees a ref the local repo has not fetched", async () => {
	const { repo, pushAnotherCommit } = seedRepoWithRemote();
	const localBefore = git(repo, ["rev-parse", "refs/remotes/origin/main"]).out;
	const pushed = pushAnotherCommit();

	const result = await probeRemoteRefs(repo, "origin", ["main"], 10_000);
	expect(result.heads.main).toBe(pushed);
	expect(result.heads.main).not.toBe(localBefore);
	// The probe told us the remote moved WITHOUT moving our local tracking ref — the whole point.
	expect(git(repo, ["rev-parse", "refs/remotes/origin/main"]).out).toBe(localBefore);
});

test("probeRemoteRefs filters ls-remote's suffix-matched patterns down to exactly the requested ref names", async () => {
	// `git ls-remote --heads origin main` doesn't match refs/heads/main exactly — a bare pattern also
	// matches any ref whose LAST path component equals it, so a `feature/main` branch comes back too
	// (verified directly: `ls-remote --heads origin main` against a remote holding both `main` and
	// `feature/main` returns both rows). Harmless if a caller only reads `heads["main"]`, but a caller that
	// iterates `Object.keys(heads)` must see exactly what it asked for, or it will process a ref it never
	// requested.
	const { repo, remote } = seedRepoWithRemote();
	run(repo, ["push", "origin", "main:refs/heads/feature/main"]);

	const result = await probeRemoteRefs(repo, "origin", ["main"], 10_000);
	expect(Object.keys(result.heads)).toEqual(["main"]);
	expect(result.heads.main).toBe(git(remote, ["rev-parse", "refs/heads/main"]).out);
});

test("fetchRemoteRefs moves the tracking ref and reports which moved", async () => {
	const { repo, pushAnotherCommit } = seedRepoWithRemote();
	const pushed = pushAnotherCommit();

	const result = await fetchRemoteRefs(repo, "origin", ["main"], 20_000);
	expect(result.ok).toBe(true);
	expect(result.moved).toEqual(["main"]);
	expect(git(repo, ["rev-parse", "refs/remotes/origin/main"]).out).toBe(pushed);

	// A second fetch with nothing new reports no movement.
	const again = await fetchRemoteRefs(repo, "origin", ["main"], 20_000);
	expect(again.ok).toBe(true);
	expect(again.moved).toEqual([]);
});

test("fetchRemoteRefs reads the FULLY QUALIFIED tracking ref, so a local branch literally named origin/main can't shadow the move check", async () => {
	// The identical hazard `prefetchBranch` (`git.ts`) guards against, exercised the same way: a local
	// branch literally named `origin/main` (`refs/heads/origin/main`) sits earlier in git's DWIM resolution
	// order than the remote-tracking ref `refs/remotes/origin/main`. A before/after comparison that reads
	// the short name `origin/main` would be comparing this never-moving local branch against itself on both
	// sides — reporting no movement even though the remote (and the real tracking ref) moved.
	const { repo, pushAnotherCommit } = seedRepoWithRemote();
	run(repo, ["update-ref", "refs/heads/origin/main", "HEAD"]);

	const pushed = pushAnotherCommit();
	const result = await fetchRemoteRefs(repo, "origin", ["main"], 20_000);
	expect(result.ok).toBe(true);
	expect(result.moved).toEqual(["main"]);
	expect(git(repo, ["rev-parse", "refs/remotes/origin/main"]).out).toBe(pushed);

	run(repo, ["update-ref", "-d", "refs/heads/origin/main"]);
});

test("only a fetch makes a behind-count possible; a probe cannot count", async () => {
	// This test IS the design's crux. The probe deliberately writes nothing, so the commits it learns about
	// are not local and cannot be counted — which is exactly why probe mode reports "unknown" to the UI
	// instead of a number, and why the indicator degrades to a bare arrow.
	const { repo, pushAnotherCommit } = seedRepoWithRemote();
	expect(refDelta(repo, "HEAD", "refs/remotes/origin/main")).toEqual({ ahead: 0, behind: 0 });

	pushAnotherCommit();

	// After a probe: we KNOW the remote moved, but the count is still 0 because we do not have the object.
	const probed = await probeRemoteRefs(repo, "origin", ["main"], 10_000);
	expect(probed.ok).toBe(true);
	expect(refDelta(repo, "HEAD", "refs/remotes/origin/main")).toEqual({ ahead: 0, behind: 0 });

	// After a real fetch the object is local, and only now is the number available.
	await fetchRemoteRefs(repo, "origin", ["main"], 20_000);
	expect(refDelta(repo, "HEAD", "refs/remotes/origin/main")).toEqual({ ahead: 0, behind: 1 });

	// A second push, fetched again, must be reflected too — pins that the count isn't hardcoded to 1.
	pushAnotherCommit();
	await fetchRemoteRefs(repo, "origin", ["main"], 20_000);
	expect(refDelta(repo, "HEAD", "refs/remotes/origin/main")).toEqual({ ahead: 0, behind: 2 });

	// An unresolvable ref answers `null`, never zeroes — an unknown distance is not "up to date", and the
	// UI renders the two differently.
	expect(refDelta(repo, "HEAD", "refs/does/not/exist")).toBe(null);
});

test("refDelta reports BOTH sides, so a rewind and a divergence are distinguishable from a fast-forward", () => {
	// The whole reason this is `--left-right` and not a two-dot count: `from..to` collapses "the upstream
	// was force-pushed backward" into the same `0` as "up to date", which is what let the indicator render
	// a lying `↓·0`. Only `ahead` can tell those apart.
	const { repo } = seedRepoWithRemote();
	const base = git(repo, ["rev-parse", "HEAD"]).out;

	// Two commits forward on a side branch, then back to base: `base` is now strictly behind `forward`.
	run(repo, ["commit", "--allow-empty", "-m", "one"]);
	run(repo, ["commit", "--allow-empty", "-m", "two"]);
	const forward = git(repo, ["rev-parse", "HEAD"]).out;

	// Fast-forward: nothing dropped, two gained.
	expect(refDelta(repo, base, forward)).toEqual({ ahead: 0, behind: 2 });
	// Rewind: the mirror image — two dropped, nothing gained. A two-dot count would have said `0` here,
	// indistinguishable from up-to-date.
	expect(refDelta(repo, forward, base)).toEqual({ ahead: 2, behind: 0 });

	// Divergence: a second line of history off the same base — each side has commits the other lacks.
	run(repo, ["checkout", "--quiet", "-b", "other", base]);
	run(repo, ["commit", "--allow-empty", "-m", "three"]);
	const diverged = git(repo, ["rev-parse", "HEAD"]).out;
	expect(refDelta(repo, forward, diverged)).toEqual({ ahead: 2, behind: 1 });
});

test("an unreachable remote fails without hanging and without prompting", async () => {
	const { repo } = seedRepoWithRemote();
	run(repo, ["remote", "set-url", "origin", "https://127.0.0.1:1/nope.git"]);
	const result = await probeRemoteRefs(repo, "origin", ["main"], 5_000);
	expect(result.ok).toBe(false);
	expect(result.err.length).toBeGreaterThan(0);
});

test("fetchRemoteRefs never prunes or fetches tags: a stale remote-tracking branch and a remote tag both survive", async () => {
	const { repo, remote, pushAnotherCommit } = seedRepoWithRemote();
	// A second branch on the remote, fetched once so it has a local tracking ref, then deleted upstream —
	// exactly the shape `--prune` would clean up (and exactly the ref a workspace could still be pinned to).
	run(repo, ["push", "origin", "main:refs/heads/doomed"]);
	pushAnotherCommit();
	await fetchRemoteRefs(repo, "origin", ["main", "doomed"], 20_000);
	expect(git(repo, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/doomed"]).ok).toBe(
		true,
	);
	// Delete it from a THROWAWAY clone, not `repo` itself: pushing a delete from the same repo that holds
	// the tracking ref opportunistically deletes that local ref too (git mirrors the push's effect,
	// verified empirically) — which would prove nothing about `fetchRemoteRefs`'s own `--prune` avoidance.
	const deleter = join(dataDir, "deleter");
	run(dataDir, ["clone", "-q", remote, deleter]);
	run(deleter, ["push", "origin", "--delete", "doomed"]);

	run(remote, ["tag", "v-marker", "main"]);

	await fetchRemoteRefs(repo, "origin", ["main"], 20_000);

	// Still present locally: a real `--prune` would have removed it once `doomed` vanished upstream.
	expect(git(repo, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/doomed"]).ok).toBe(
		true,
	);
	// Never fetched: no `--tags`, so the remote's tag never reached this local repo's `refs/tags`.
	expect(git(repo, ["rev-parse", "--verify", "--quiet", "refs/tags/v-marker"]).ok).toBe(false);
});

test("remoteUrlKind classifies ssh:// URLs, both SCP-like forms, and non-ssh remotes", () => {
	const { repo, remote } = seedRepoWithRemote();
	run(repo, ["remote", "set-url", "origin", "ssh://git@example.com/org/repo.git"]);
	expect(remoteUrlKind(repo, "origin")).toBe("ssh");

	run(repo, ["remote", "set-url", "origin", "git@github.com:org/repo.git"]);
	expect(remoteUrlKind(repo, "origin")).toBe("ssh");

	run(repo, ["remote", "set-url", "origin", "alice@example.com:org/repo.git"]);
	expect(remoteUrlKind(repo, "origin")).toBe("ssh");

	// The `user@` prefix is OPTIONAL in git's scp-like syntax — a bare `host:path` with no leading slash
	// before the colon is still SSH (confirmed directly: `GIT_TRACE=1 git fetch` against
	// `buildserver.internal:org/repo.git` shells out to `ssh buildserver.internal git-upload-pack ...`).
	// Under-matching here is the dangerous direction (an SSH remote gets background-probed when the ladder
	// meant to skip it), so this form must classify as `"ssh"`, not fall through to `"other"`.
	run(repo, ["remote", "set-url", "origin", "buildserver.internal:org/repo.git"]);
	expect(remoteUrlKind(repo, "origin")).toBe("ssh");

	run(repo, ["remote", "set-url", "origin", "https://example.com/org/repo.git"]);
	expect(remoteUrlKind(repo, "origin")).toBe("other");

	// A plain local path (the fixture's own bare remote, restored) is not SSH either.
	run(repo, ["remote", "set-url", "origin", remote]);
	expect(remoteUrlKind(repo, "origin")).toBe("other");

	expect(remoteUrlKind(repo, "no-such-remote")).toBe("unknown");
});

test("sshAgentPresent: unset/empty -> false; a real-looking agent path -> true; EITHER macOS launchd default-socket root -> false", () => {
	// Explicit-argument calls, no env mutation needed — deterministic regardless of the host's own
	// SSH_AUTH_SOCK (this dev machine's happens to itself be a launchd default, which is exactly the
	// defect this test pins).
	expect(sshAgentPresent(undefined)).toBe(false);
	expect(sshAgentPresent("")).toBe(false);
	expect(sshAgentPresent("/tmp/ssh-agent.sock")).toBe(true);

	// launchd generates this directory name per-session with a random token; nothing user-run organically
	// produces it. Both roots are real across macOS versions/session types (this repo's own docstring
	// named only one, which was itself part of the bug) — matched as a path SEGMENT, independent of root.
	expect(sshAgentPresent("/private/tmp/com.apple.launchd.QsVPEn8zeh/Listeners")).toBe(false);
	expect(sshAgentPresent("/var/run/com.apple.launchd.QsVPEn8zeh/Listeners")).toBe(false);

	// A launchd-SHAPED path whose leaf isn't literally "Listeners" is not the default socket — a real
	// agent could in principle live under a similarly-named directory. Only the exact leaf name is carved
	// out, not the whole `com.apple.launchd.*` prefix.
	expect(sshAgentPresent("/private/tmp/com.apple.launchd.QsVPEn8zeh/sock.real")).toBe(true);
});

test("sshAgentPresent()'s default parameter reads SSH_AUTH_SOCK directly — the launchd carve-out applies to real callers, not just explicit-argument tests", () => {
	// Reproduces the reported defect verbatim: this repo's own dev machine has
	// SSH_AUTH_SOCK=/var/run/com.apple.launchd.<token>/Listeners by default, and every production call site
	// calls `sshAgentPresent()` with no arguments.
	process.env.SSH_AUTH_SOCK = "/var/run/com.apple.launchd.ABC123xyz/Listeners";
	expect(sshAgentPresent()).toBe(false);

	delete process.env.SSH_AUTH_SOCK;
	expect(sshAgentPresent()).toBe(false);
});
