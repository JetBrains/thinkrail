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
	expect(isApproved("p1", "onCreate", "shared", "pnpm install")).toBe(false);
});

test("approveHook then isApproved is true for the exact same material", () => {
	approveHook("p1", "onCreate", "shared", "pnpm install");
	expect(isApproved("p1", "onCreate", "shared", "pnpm install")).toBe(true);
});

test("isApproved is false once the material changes", () => {
	approveHook("p1", "onCreate", "shared", "pnpm install");
	expect(isApproved("p1", "onCreate", "shared", "pnpm install --frozen-lockfile")).toBe(false);
});

test("approvals are scoped per hook — approving onCreate doesn't approve onDelete", () => {
	approveHook("p1", "onCreate", "shared", "pnpm install");
	expect(isApproved("p1", "onDelete", "shared", "pnpm install")).toBe(false);
});

test("approvals are scoped per project", () => {
	approveHook("p1", "onCreate", "shared", "pnpm install");
	expect(isApproved("p2", "onCreate", "shared", "pnpm install")).toBe(false);
});

test("shared and local sources are approved independently for the same project+hook", () => {
	approveHook("p1", "onCreate", "shared", "cmdA");
	approveHook("p1", "onCreate", "local", "cmdB");

	expect(isApproved("p1", "onCreate", "shared", "cmdA")).toBe(true);
	expect(isApproved("p1", "onCreate", "local", "cmdB")).toBe(true);
});

test("approving one source does not approve the other source's material", () => {
	approveHook("p1", "onCreate", "shared", "cmdA");

	// The local source has no approval at all yet, regardless of material.
	expect(isApproved("p1", "onCreate", "local", "cmdA")).toBe(false);
	// Checking the shared material against the local source is also false.
	expect(isApproved("p1", "onCreate", "local", "cmdB")).toBe(false);
});

test("isApproved is false for the right material but the wrong source", () => {
	approveHook("p1", "onCreate", "shared", "cmdA");
	expect(isApproved("p1", "onCreate", "local", "cmdA")).toBe(false);
});

test("re-approving a source replaces its prior hash without disturbing the other source", () => {
	approveHook("p1", "onCreate", "shared", "cmdA");
	approveHook("p1", "onCreate", "local", "cmdB");

	approveHook("p1", "onCreate", "local", "cmdC");

	expect(isApproved("p1", "onCreate", "local", "cmdB")).toBe(false);
	expect(isApproved("p1", "onCreate", "local", "cmdC")).toBe(true);
	// Re-approving local left the shared approval untouched.
	expect(isApproved("p1", "onCreate", "shared", "cmdA")).toBe(true);
});
