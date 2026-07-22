import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadHookApprovals,
	loadHookOverrides,
	loadWorkspaces,
	saveHookApprovals,
	saveHookOverrides,
} from "./persistence";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-persistence-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("loadHookOverrides defaults to an empty object when the file doesn't exist", () => {
	expect(loadHookOverrides()).toEqual({});
});

test("saveHookOverrides then loadHookOverrides round-trips", () => {
	saveHookOverrides({ p1: { onCreate: "pnpm install" } });
	expect(loadHookOverrides()).toEqual({ p1: { onCreate: "pnpm install" } });
});

test("loadHookApprovals defaults to an empty object when the file doesn't exist", () => {
	expect(loadHookApprovals()).toEqual({});
});

test("saveHookApprovals then loadHookApprovals round-trips", () => {
	saveHookApprovals({ p1: { onCreate: { shared: "abc123hash", local: "def456hash" } } });
	expect(loadHookApprovals()).toEqual({
		p1: { onCreate: { shared: "abc123hash", local: "def456hash" } },
	});
});

test("loadWorkspaces migrates a legacy flat hookStatus to source-nested under 'shared'", () => {
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				name: "workspace-1",
				branch: "workspace-1",
				worktreePath: "/tmp/w1",
				baseBranch: "main",
				hookStatus: {
					onCreate: { state: "failed", command: "npm install", exitCode: 1 },
				},
			},
		]),
	);

	expect(loadWorkspaces()[0]?.hookStatus).toEqual({
		onCreate: { shared: { state: "failed", command: "npm install", exitCode: 1 } },
	});
});

test("loadWorkspaces leaves an already source-nested hookStatus unchanged", () => {
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w2",
				projectId: "p1",
				name: "workspace-2",
				branch: "workspace-2",
				worktreePath: "/tmp/w2",
				baseBranch: "main",
				hookStatus: {
					onCreate: {
						shared: { state: "succeeded", command: "npm install" },
						local: { state: "running", command: "npm run setup" },
					},
				},
			},
		]),
	);

	expect(loadWorkspaces()[0]?.hookStatus).toEqual({
		onCreate: {
			shared: { state: "succeeded", command: "npm install" },
			local: { state: "running", command: "npm run setup" },
		},
	});
});
