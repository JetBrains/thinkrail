import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHookConfig, resolveHookCommand } from "./config";

let worktree: string;

beforeEach(() => {
	worktree = mkdtempSync(join(tmpdir(), "trpi-hooks-config-test-"));
});

afterEach(() => {
	rmSync(worktree, { recursive: true, force: true });
});

test("loadHookConfig returns {} when .thinkrail/hooks.json doesn't exist", () => {
	expect(loadHookConfig(worktree)).toEqual({});
});

test("loadHookConfig reads committed hook commands", () => {
	mkdirSync(join(worktree, ".thinkrail"), { recursive: true });
	writeFileSync(
		join(worktree, ".thinkrail", "hooks.json"),
		JSON.stringify({ onCreate: "pnpm install" }),
	);
	expect(loadHookConfig(worktree)).toEqual({ onCreate: "pnpm install" });
});

test("loadHookConfig returns {} on malformed JSON rather than throwing", () => {
	mkdirSync(join(worktree, ".thinkrail"), { recursive: true });
	writeFileSync(join(worktree, ".thinkrail", "hooks.json"), "{ not json");
	expect(loadHookConfig(worktree)).toEqual({});
});

test("resolveHookCommand: an override replaces the committed value entirely", () => {
	const committed = { onCreate: "pnpm install" };
	const override = { onCreate: "pnpm install --frozen-lockfile" };
	expect(resolveHookCommand("onCreate", committed, override)).toBe(
		"pnpm install --frozen-lockfile",
	);
});

test("resolveHookCommand: falls through to committed when there's no override for that hook", () => {
	const committed = { onCreate: "pnpm install", onDelete: "rm -rf tmp" };
	const override = { onCreate: "pnpm install --frozen-lockfile" };
	expect(resolveHookCommand("onDelete", committed, override)).toBe("rm -rf tmp");
});

test("resolveHookCommand: undefined when neither committed nor override declares the hook", () => {
	expect(resolveHookCommand("preMerge", {}, {})).toBeUndefined();
});
