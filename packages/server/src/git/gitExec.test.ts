import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveCommitOid } from "./diffScope";
import {
	git,
	gitAsync,
	gitAsyncBytes,
	gitBytes,
	indexWriteTimeoutFor,
	nonInteractiveGitEnv,
	SLOW_GIT_TIMEOUT_MS,
	setSyncGitTimeoutForTests,
	throwOnTimeout,
} from "./gitExec";

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

	const result = await gitAsync(repo, ["fetch", "origin"], { network: true });

	expect(result.ok).toBe(false);
	expect(result.failure).toBeUndefined();
	expect(result.err).toContain("example.invalid git-upload-pack");
	expect(result.err).not.toContain("BatchMode");
});

posix("a grandchild outliving git does not turn a finished fetch into a timeout", async () => {
	sshRemoteVia("sleep 5 </dev/null >/dev/null &\nexit 0");

	const result = await gitAsync(repo, ["fetch", "origin"], {
		network: true,
		timeoutMs: 5_000,
	});

	expect(result.ok).toBe(false);
	expect(result.err).toContain("Could not read from remote repository");
	expect(result.err).not.toContain("timed out after");
});

posix("gitAsync ends a stalled fetch at the timeout and names the likely cause", async () => {
	const reached = sshRemoteVia("sleep 30");

	const started = Date.now();
	const result = await gitAsync(repo, ["fetch", "origin"], {
		network: true,
		timeoutMs: 500,
	});
	const elapsed = Date.now() - started;

	expect(existsSync(reached)).toBe(true);
	expect(result.ok).toBe(false);
	expect(result.failure).toBe("timeout");
	expect(result.err).toContain("timed out after");
	expect(result.err).toContain("the remote never answered");
	expect(result.err).not.toMatch(/git (is )?waiting for SSH/);
	expect(elapsed).toBeLessThan(5_000);
});

posix("a stalled local read reports only that git did not exit", async () => {
	const result = await gitAsync(repo, ["-c", "alias.wait=!sleep 30", "wait"], {
		timeoutMs: 500,
	});

	expect(result.ok).toBe(false);
	expect(result.err).toContain("timed out after");
	expect(result.err).toContain("git did not exit");
	expect(result.err).not.toContain("remote");
	expect(result.err).not.toContain("ssh-add");
});

posix("a stalled fetch keeps what git actually wrote before the kill", async () => {
	sshRemoteVia('echo "REMOTE-SAID-THIS" >&2\nsleep 30');

	const result = await gitAsync(repo, ["fetch", "origin"], {
		network: true,
		timeoutMs: 500,
	});

	expect(result.ok).toBe(false);
	expect(result.err).toContain("timed out after");
	expect(result.err).toContain("REMOTE-SAID-THIS");
	expect(result.err).not.toContain("the remote never answered");
});

posix("an oversized stderr is truncated before it can reach a client", async () => {
	sshRemoteVia("head -c 40000 /dev/zero | tr '\\0' 'x' >&2\nexit 1");

	const result = await gitAsync(repo, ["fetch", "origin"], { network: true });

	expect(result.ok).toBe(false);
	expect(result.err.length).toBeLessThanOrEqual(2_000);
	expect(result.err).toContain("… (truncated) …");
	expect(result.err).toContain("Could not read from remote repository");
});

posix("gitAsyncBytes bounds a stalled git wrapper and classifies the timeout", async () => {
	const executable = Bun.which("git");
	if (!executable) throw new Error("git not found");
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const wrapper = join(bin, "git");
	writeFileSync(wrapper, `#!/bin/sh\nsleep 30\nexec ${JSON.stringify(executable)} "$@"\n`);
	chmodSync(wrapper, 0o755);
	const path = process.env.PATH;
	process.env.PATH = `${bin}${delimiter}${path ?? ""}`;
	const result = await (async () => {
		try {
			return await gitAsyncBytes(repo, ["status"], { timeoutMs: 200 });
		} finally {
			if (path === undefined) delete process.env.PATH;
			else process.env.PATH = path;
		}
	})();

	expect(result.ok).toBe(false);
	expect(result.failure).toBe("timeout");
	expect(result.err).toContain("timed out after");
	expect(result.err).toContain("git did not exit");
	expect(result.out).toEqual(new Uint8Array());
});

posix("the sync runners kill a hanging git at the deadline instead of holding the loop", () => {
	const bin = join(dir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "git"), "#!/bin/sh\necho partial >&2\nsleep 30\n");
	chmodSync(join(bin, "git"), 0o755);
	const path = process.env.PATH;
	process.env.PATH = `${bin}${delimiter}${path ?? ""}`;
	const started = performance.now();
	const [text, bytes] = (() => {
		try {
			return [
				git(repo, ["rev-parse", "HEAD"], { timeoutMs: 300 }),
				gitBytes(repo, ["cat-file", "blob", "HEAD:x"], { timeoutMs: 300 }),
			];
		} finally {
			if (path === undefined) delete process.env.PATH;
			else process.env.PATH = path;
		}
	})();

	expect(performance.now() - started).toBeLessThan(5_000);
	for (const result of [text, bytes]) {
		expect(result.ok).toBe(false);
		expect(result.failure).toBe("timeout");
		expect(result.err).toContain("timed out after");
		expect(result.err).toContain("partial");
		expect(result.out.length).toBe(0);
		expect(() => throwOnTimeout(result, "read HEAD")).toThrow(/^Could not read HEAD: timed out/);
		expect(() => throwOnTimeout(result, "read HEAD")).toThrow(
			expect.objectContaining({ name: "GitTimeoutError", code: "GIT_TIMEOUT" }),
		);
	}
	const exited = git(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/missing"]);
	expect(throwOnTimeout(exited, "read HEAD")).toBe(exited);
});

test("a timeout's consequence follows the git detail as its own sentence", () => {
	const stalled = (err: string) => ({ ok: false, out: "", err, failure: "timeout" as const });
	expect(() =>
		throwOnTimeout(
			stalled("timed out after 10s — git did not exit"),
			"check x",
			"Nothing was deleted.",
		),
	).toThrow("Could not check x: timed out after 10s — git did not exit. Nothing was deleted.");
	expect(() =>
		throwOnTimeout(stalled("timed out after 10s — stuck."), "check x", "Nothing was deleted."),
	).toThrow("Could not check x: timed out after 10s — stuck. Nothing was deleted.");
});

posix("resolveCommitOid throws on a timeout instead of reporting no commit", () => {
	const bin = join(dir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "git"), "#!/bin/sh\nsleep 30\n");
	chmodSync(join(bin, "git"), 0o755);
	const path = process.env.PATH;
	process.env.PATH = `${bin}${delimiter}${path ?? ""}`;
	setSyncGitTimeoutForTests(300);
	try {
		expect(() => resolveCommitOid(repo, "HEAD")).toThrow(
			expect.objectContaining({ code: "GIT_TIMEOUT" }),
		);
	} finally {
		setSyncGitTimeoutForTests(undefined);
		if (path === undefined) delete process.env.PATH;
		else process.env.PATH = path;
	}
	expect(resolveCommitOid(repo, "refs/heads/missing")).toBe(null);
});

posix(
	"a sync git stopped at its deadline removes its index.lock and leaves no filter behind",
	() => {
		const marker = `sleep ${30 + Math.floor(Math.random() * 1_000) / 1_000}`;
		run(repo, "config", "filter.slow.clean", `${marker}; cat`);
		writeFileSync(join(repo, ".gitattributes"), "*.txt filter=slow\n");
		writeFileSync(join(repo, "a.txt"), "hi\n");

		const started = performance.now();
		const result = git(repo, ["add", "-A"], { timeoutMs: 500 });

		expect(performance.now() - started).toBeLessThan(5_000);
		expect(result.failure).toBe("timeout");
		expect(existsSync(join(repo, ".git", "index.lock"))).toBe(false);
		expect(Bun.spawnSync(["pgrep", "-f", marker]).exitCode).toBe(1);
		run(repo, "config", "--unset", "filter.slow.clean");
		expect(git(repo, ["add", "-A"]).ok).toBe(true);
	},
);

test("index writers get no deadline on Windows, where a kill cannot let git drop index.lock", () => {
	expect(indexWriteTimeoutFor("win32")).toBeNull();
	expect(indexWriteTimeoutFor("darwin")).toBe(SLOW_GIT_TIMEOUT_MS);
	expect(indexWriteTimeoutFor("linux")).toBe(SLOW_GIT_TIMEOUT_MS);
});

posix("a null timeoutMs runs sync git with no deadline at all", () => {
	const bin = join(dir, "bin");
	mkdirSync(bin);
	writeFileSync(
		join(bin, "git"),
		`#!/bin/sh\nsleep 1\nexec ${JSON.stringify(Bun.which("git"))} "$@"\n`,
	);
	chmodSync(join(bin, "git"), 0o755);
	const path = process.env.PATH;
	process.env.PATH = `${bin}${delimiter}${path ?? ""}`;
	setSyncGitTimeoutForTests(300);
	try {
		expect(git(repo, ["rev-parse", "--git-dir"]).failure).toBe("timeout");
		expect(git(repo, ["rev-parse", "--git-dir"], { timeoutMs: null }).ok).toBe(true);
	} finally {
		setSyncGitTimeoutForTests(undefined);
		if (path === undefined) delete process.env.PATH;
		else process.env.PATH = path;
	}
});

test("the async git runners distinguish a launch failure from git's own nonzero exit", async () => {
	const path = process.env.PATH;
	process.env.PATH = join(repo, "missing-bin");
	const [text, bytes] = await (async () => {
		try {
			return await Promise.all([gitAsync(repo, ["status"]), gitAsyncBytes(repo, ["status"])]);
		} finally {
			if (path === undefined) delete process.env.PATH;
			else process.env.PATH = path;
		}
	})();

	for (const result of [text, bytes]) {
		expect(result.ok).toBe(false);
		expect(result.failure).toBe("launch");
		expect(result.err).not.toBe("");
	}
});

test("pre-cancellation skips Git mutations and classifies both async runners", async () => {
	const target = join(dir, "never-created");
	const opts = { signal: AbortSignal.abort(), network: true };
	const text = await gitAsync(repo, ["init", target], opts);
	const bytes = await gitAsyncBytes(repo, ["init", target], opts);
	for (const result of [text, bytes]) {
		expect(result).toMatchObject({ ok: false, failure: "aborted", err: "git operation cancelled" });
	}
	expect(text.out).toBe("");
	expect(bytes.out).toEqual(new Uint8Array());
	expect(existsSync(target)).toBe(false);
});

posix("in-flight cancellation keeps text and byte output with an explicit diagnosis", async () => {
	for (const bytes of [false, true]) {
		const ready = join(dir, `ready-${bytes}`);
		const controller = new AbortController();
		const args = [
			"-c",
			`alias.wait=!printf ' partial '; printf 'diagnosis' >&2; touch '${ready}'; sleep 30`,
			"wait",
		];
		const opts = { signal: controller.signal, timeoutMs: 10_000, network: true };
		const pending = bytes
			? gitAsyncBytes(repo, args, opts)
			: gitAsync(repo, args, { ...opts, raw: true });
		try {
			for (let attempt = 0; attempt < 300 && !existsSync(ready); attempt++) await Bun.sleep(10);
			expect(existsSync(ready)).toBe(true);
			controller.abort();
			const result = await pending;
			expect(result).toMatchObject({
				ok: false,
				failure: "aborted",
				err: "git operation cancelled — diagnosis",
			});
			expect(result.out).toEqual(bytes ? new TextEncoder().encode(" partial ") : " partial ");
		} finally {
			controller.abort();
			await pending;
		}
	}
});

test("a later abort does not change a completed Git result", async () => {
	const controller = new AbortController();
	const opts = { signal: controller.signal };
	const results = await Promise.all([
		gitAsync(repo, ["rev-parse", "--git-dir"], opts),
		gitAsyncBytes(repo, ["rev-parse", "--git-dir"], opts),
	]);
	controller.abort();
	for (const result of results) {
		expect(result.ok).toBe(true);
		expect(result).not.toHaveProperty("failure");
	}
});

test("git reports git's own stderr, trimmed", () => {
	const result = git(repo, ["rev-parse", "--verify", "refs/heads/nope"]);

	expect(result.ok).toBe(false);
	expect(result.err).toContain("Needed a single revision");
	expect(result.err).toBe(result.err.trim());
});
