import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveHook, isApproved } from "./approvals";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-hooks-approvals-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("isApproved is false for a command that's never been approved", () => {
	expect(isApproved("p1", "onCreate", "pnpm install")).toBe(false);
});

test("approveHook then isApproved is true for the exact same command", () => {
	approveHook("p1", "onCreate", "pnpm install");
	expect(isApproved("p1", "onCreate", "pnpm install")).toBe(true);
});

test("isApproved is false once the command string changes", () => {
	approveHook("p1", "onCreate", "pnpm install");
	expect(isApproved("p1", "onCreate", "pnpm install --frozen-lockfile")).toBe(false);
});

test("approvals are scoped per hook — approving onCreate doesn't approve onDelete", () => {
	approveHook("p1", "onCreate", "pnpm install");
	expect(isApproved("p1", "onDelete", "pnpm install")).toBe(false);
});

test("approvals are scoped per project", () => {
	approveHook("p1", "onCreate", "pnpm install");
	expect(isApproved("p2", "onCreate", "pnpm install")).toBe(false);
});
