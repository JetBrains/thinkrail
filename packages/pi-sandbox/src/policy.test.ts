import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canRead, canWrite, defaultSandboxPolicy } from "./policy";

const home = "/sandbox-home";
const cwd = join(home, "work/repo");
const policy = defaultSandboxPolicy(cwd, home);

test("writes are confined to the workspace, temp, and package caches", () => {
	expect(canWrite(policy, join(cwd, "src/a.ts"))).toBe(true);
	expect(canWrite(policy, join(tmpdir(), "scratch"))).toBe(true);
	expect(canWrite(policy, join(home, ".npm/_cacache"))).toBe(true);
	expect(canWrite(policy, join(home, ".zshrc"))).toBe(false);
	expect(canWrite(policy, "/etc/hosts")).toBe(false);
	expect(canWrite(policy, `${cwd}-sibling/a.ts`)).toBe(false);
});

test("credential stores are unreadable while the rest of the machine stays readable", () => {
	expect(canRead(policy, join(home, ".ssh/id_ed25519"))).toBe(false);
	expect(canRead(policy, join(home, ".pi/agent/auth.json"))).toBe(false);
	expect(canRead(policy, join(home, ".thinkrail/state.json"))).toBe(false);
	expect(canRead(policy, join(home, ".pi/agent/settings.json"))).toBe(true);
	expect(canRead(policy, "/usr/include/stdio.h")).toBe(true);
});

test("a workspace inside a read-denied data dir stays readable and writable", () => {
	const worktree = join(home, ".thinkrail/worktrees/app/feature");
	const inside = defaultSandboxPolicy(worktree, home);
	expect(canRead(inside, join(worktree, "src/a.ts"))).toBe(true);
	expect(canWrite(inside, join(worktree, "src/a.ts"))).toBe(true);
	expect(canRead(inside, join(home, ".thinkrail/config.json"))).toBe(false);
});

test("a symlink inside the workspace cannot launder a path outside it", () => {
	const root = mkdtempSync(join(tmpdir(), "sandbox-symlink-"));
	const worktree = join(root, "repo");
	const outside = join(root, "outside");
	mkdirSync(worktree);
	mkdirSync(outside);
	symlinkSync(outside, join(worktree, "escape"));
	const linked = { ...defaultSandboxPolicy(worktree, home), allowWrite: [worktree] };
	expect(canWrite(linked, join(worktree, "escape/file.txt"))).toBe(false);
	expect(canWrite(linked, join(worktree, "new/file.txt"))).toBe(true);
});

test("git hooks and config stay read-only so an agent cannot plant code that runs outside the sandbox", () => {
	const root = mkdtempSync(join(tmpdir(), "sandbox-git-"));
	Bun.spawnSync(["git", "init", "-q", root]);
	const repo = defaultSandboxPolicy(root, home);
	expect(canWrite(repo, join(root, ".git/objects/ab/cdef"))).toBe(true);
	expect(canWrite(repo, join(root, ".git/hooks/pre-commit"))).toBe(false);
	expect(canWrite(repo, join(root, ".git/config"))).toBe(false);
	expect(canWrite(repo, join(root, ".env.local"))).toBe(false);
	expect(canWrite(repo, join(root, "deploy.key"))).toBe(false);
	expect(canWrite(repo, join(root, "keyboard.ts"))).toBe(true);
});
