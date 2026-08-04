import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./gitExec";
import {
	behindCount,
	fetchRemoteRefs,
	fetchRemoteRefsArgv,
	probeRemoteRefs,
	probeRemoteRefsArgv,
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
 * A bare remote + a working repo whose `origin` already has `refs/remotes/origin/main` recorded (a push
 * opportunistically updates the local tracking ref for a branch matching `remote add`'s default fetch
 * refspec — verified empirically), so `behindCount` has something to compare against from the start. Plus
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
	const before = {
		remoteRefs: git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"])
			.out,
		fetchHead: existsSync(join(repo, ".git", "FETCH_HEAD")),
		locks: git(repo, ["ls-files", "--others", "--", ".git/*.lock"]).out,
	};

	const result = await probeRemoteRefs(repo, "origin", ["main"], 10_000);
	expect(result.ok).toBe(true);
	expect(result.heads.main).toMatch(/^[0-9a-f]{40}$/);

	const after = {
		remoteRefs: git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"])
			.out,
		fetchHead: existsSync(join(repo, ".git", "FETCH_HEAD")),
		locks: git(repo, ["ls-files", "--others", "--", ".git/*.lock"]).out,
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
	expect(behindCount(repo, "HEAD", "refs/remotes/origin/main")).toBe(0);

	pushAnotherCommit();

	// After a probe: we KNOW the remote moved, but the count is still 0 because we do not have the object.
	const probed = await probeRemoteRefs(repo, "origin", ["main"], 10_000);
	expect(probed.ok).toBe(true);
	expect(behindCount(repo, "HEAD", "refs/remotes/origin/main")).toBe(0);

	// After a real fetch the object is local, and only now is the number available.
	await fetchRemoteRefs(repo, "origin", ["main"], 20_000);
	expect(behindCount(repo, "HEAD", "refs/remotes/origin/main")).toBe(1);

	// A second push, fetched again, must be reflected too — pins that the count isn't hardcoded to 1.
	pushAnotherCommit();
	await fetchRemoteRefs(repo, "origin", ["main"], 20_000);
	expect(behindCount(repo, "HEAD", "refs/remotes/origin/main")).toBe(2);

	// An unresolvable ref answers `null`, never `0` — an unknown count is not "up to date", and the UI
	// renders the two differently.
	expect(behindCount(repo, "HEAD", "refs/does/not/exist")).toBe(null);
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

	run(repo, ["remote", "set-url", "origin", "https://example.com/org/repo.git"]);
	expect(remoteUrlKind(repo, "origin")).toBe("other");

	// A plain local path (the fixture's own bare remote, restored) is not SSH either.
	run(repo, ["remote", "set-url", "origin", remote]);
	expect(remoteUrlKind(repo, "origin")).toBe("other");

	expect(remoteUrlKind(repo, "no-such-remote")).toBe("unknown");
});

test("sshAgentPresent reads SSH_AUTH_SOCK and answers false only when unset or empty", () => {
	delete process.env.SSH_AUTH_SOCK;
	expect(sshAgentPresent()).toBe(false);

	process.env.SSH_AUTH_SOCK = "";
	expect(sshAgentPresent()).toBe(false);

	process.env.SSH_AUTH_SOCK = "/tmp/ssh-agent.sock";
	expect(sshAgentPresent()).toBe(true);
});
