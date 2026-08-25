import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitAsync, nonInteractiveGitEnv } from "./gitExec";

const posix = test.skipIf(process.platform === "win32");

const SSH_VARS = ["GIT_SSH_COMMAND", "GIT_SSH", "GIT_SSH_VARIANT"] as const;

let dir: string;
let repo: string;
let scripts = 0;
const savedEnv: Record<string, string | undefined> = {};

function run(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function sshRemoteVia(body: string): string {
	const path = join(dir, `ssh-${++scripts}.sh`);
	const reached = `${path}.reached`;
	writeFileSync(path, `#!/bin/sh\ncase "$*" in *-G*) exit 0;; esac\ntouch "${reached}"\n${body}\n`);
	chmodSync(path, 0o755);
	run(repo, "config", "core.sshCommand", `'${path}'`);
	run(repo, "remote", "add", "origin", "ssh://example.invalid/x.git");
	return reached;
}

beforeEach(() => {
	for (const name of SSH_VARS) {
		savedEnv[name] = process.env[name];
		delete process.env[name];
	}
	dir = mkdtempSync(join(tmpdir(), "trpi-gitexec-test-"));
	repo = join(dir, "repo");
	mkdirSync(repo);
	run(repo, "init", "-b", "main");
});

afterEach(() => {
	for (const name of SSH_VARS) {
		if (savedEnv[name] === undefined) delete process.env[name];
		else process.env[name] = savedEnv[name];
	}
	rmSync(dir, { recursive: true, force: true });
});

test("nonInteractiveGitEnv layers over process.env and leaves the user's ssh client alone", () => {
	process.env.GIT_SSH_COMMAND = "ssh -i /keys/sentinel";

	const env = nonInteractiveGitEnv();

	expect(env.GIT_TERMINAL_PROMPT).toBe("0");
	expect(env.PATH).toBe(process.env.PATH);
	expect(env.GIT_SSH_COMMAND).toBe("ssh -i /keys/sentinel");
});

posix("the user's core.sshCommand runs unmodified — we add no options of our own", async () => {
	sshRemoteVia('echo "ARGV: $*" >&2\nexit 42');

	const result = await gitAsync(repo, ["fetch", "origin"]);

	expect(result.ok).toBe(false);
	expect(result.err).toContain("example.invalid git-upload-pack");
	expect(result.err).not.toContain("BatchMode");
});

posix("a grandchild outliving git does not turn a finished fetch into a timeout", async () => {
	sshRemoteVia("sleep 5 </dev/null >/dev/null &\nexit 0");

	const result = await gitAsync(repo, ["fetch", "origin"], { timeoutMs: 5_000 });

	expect(result.ok).toBe(false);
	expect(result.err).toContain("Could not read from remote repository");
	expect(result.err).not.toContain("timed out after");
});

posix("gitAsync ends a stalled fetch at the timeout and names the likely cause", async () => {
	const reached = sshRemoteVia("sleep 30");

	const started = Date.now();
	const result = await gitAsync(repo, ["fetch", "origin"], { timeoutMs: 500 });
	const elapsed = Date.now() - started;

	expect(existsSync(reached)).toBe(true);
	expect(result.ok).toBe(false);
	expect(result.err).toContain("timed out after");
	expect(result.err).toContain("the remote never answered");
	expect(result.err).not.toMatch(/git (is )?waiting for SSH/);
	expect(elapsed).toBeLessThan(5_000);
});

posix("a stalled fetch keeps what git actually wrote before the kill", async () => {
	sshRemoteVia('echo "REMOTE-SAID-THIS" >&2\nsleep 30');

	const result = await gitAsync(repo, ["fetch", "origin"], { timeoutMs: 500 });

	expect(result.ok).toBe(false);
	expect(result.err).toContain("timed out after");
	expect(result.err).toContain("REMOTE-SAID-THIS");
	expect(result.err).not.toContain("the remote never answered");
});

posix("an oversized stderr is truncated before it can reach a client", async () => {
	sshRemoteVia("head -c 40000 /dev/zero | tr '\\0' 'x' >&2\nexit 1");

	const result = await gitAsync(repo, ["fetch", "origin"]);

	expect(result.ok).toBe(false);
	expect(result.err.length).toBeLessThanOrEqual(2_000);
	expect(result.err).toContain("… (truncated) …");
	expect(result.err).toContain("Could not read from remote repository");
});

test("git reports git's own stderr, trimmed", () => {
	const result = git(repo, ["rev-parse", "--verify", "refs/heads/nope"]);

	expect(result.ok).toBe(false);
	expect(result.err).toContain("Needed a single revision");
	expect(result.err).toBe(result.err.trim());
});
