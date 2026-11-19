import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ARTIFACTS_RULE,
	ARTIFACTS_SECTION,
	artifactsGuard,
	temporaryWriteTarget,
} from "./artifactsGuard";

let base: string;
let workspace: string;

beforeEach(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "trpi-artifacts-guard-")));
	workspace = join(base, "worktree");
	mkdirSync(workspace);
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

test("temporary folders outside the workspace are refused, everything else is allowed", () => {
	const home = join(homedir(), "notes.md");
	expect(temporaryWriteTarget("/tmp/report.md", workspace)).toBe("/tmp/report.md");
	expect(temporaryWriteTarget("@/tmp/shot.png", workspace)).toBe("/tmp/shot.png");
	expect(temporaryWriteTarget("/var/tmp/x/y.txt", workspace)).toBe("/var/tmp/x/y.txt");
	expect(temporaryWriteTarget(join(tmpdir(), "a.md"), workspace)).not.toBeNull();
	expect(temporaryWriteTarget("../outside.md", workspace)).not.toBeNull();
	expect(temporaryWriteTarget(".thinkrail/context/report.md", workspace)).toBeNull();
	expect(temporaryWriteTarget(join(workspace, "src", "a.ts"), workspace)).toBeNull();
	expect(temporaryWriteTarget("~/notes.md", workspace)).toBeNull();
	expect(temporaryWriteTarget(home, workspace)).toBeNull();
});

test("the extension adds the artifacts rule and refuses only a new file in a temporary folder", async () => {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI;
	await artifactsGuard(pi);

	const sections: Record<string, string> = {};
	handlers.get("before_agent_start")?.({ systemPromptOptions: { sections } }, {});
	expect(sections[ARTIFACTS_SECTION]).toBe(ARTIFACTS_RULE);

	const call = (toolName: string, path: string) =>
		handlers.get("tool_call")?.({ toolName, input: { path } }, { cwd: workspace });
	const fresh = join(base, "report.md");
	const existing = join(base, "repro.py");
	writeFileSync(existing, "print('bug')\n");
	expect(call("write", fresh)).toMatchObject({
		block: true,
		reason: expect.stringContaining(".thinkrail/context/report.md"),
	});
	expect(call("write", existing)).toBeUndefined();
	expect(call("edit", existing)).toBeUndefined();
	expect(call("edit", fresh)).toBeUndefined();
	expect(call("write", ".thinkrail/context/report.md")).toBeUndefined();
	expect(call("read", fresh)).toBeUndefined();
});
