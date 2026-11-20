import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	memberWriteTarget,
	ORCHESTRATOR_RULE,
	ORCHESTRATOR_SECTION,
	orchestratorPolicy,
	setOrchestratorHomeResolver,
} from "./orchestratorPolicy";

const symlinks = process.platform !== "win32";
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

let base: string;
let home: string;
let member: string;

beforeEach(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "trpi-orchestrator-policy-")));
	home = join(base, "containers", "c1");
	member = join(base, "worktrees", "thinkrail", "feat");
	mkdirSync(join(home, ".thinkrail", "context"), { recursive: true });
	mkdirSync(join(home, "workspaces"), { recursive: true });
	mkdirSync(join(member, "src"), { recursive: true });
	symlinkSync(member, join(home, "workspaces", "thinkrail-feat"), LINK_TYPE);
});

afterEach(() => {
	setOrchestratorHomeResolver(null);
	rmSync(base, { recursive: true, force: true });
});

function load(workspaceId: string, rule?: boolean) {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI;
	void orchestratorPolicy(workspaceId, rule === undefined ? {} : { rule })(pi);
	return {
		sections() {
			const sections: Record<string, string> = {};
			handlers.get("before_agent_start")?.({ systemPromptOptions: { sections } }, {});
			return sections;
		},
		call(toolName: string, path: string, cwd = home) {
			return handlers.get("tool_call")?.({ toolName, input: { path } }, { cwd });
		},
	};
}

test.if(symlinks)(
	"member code is refused under the links and through any path that resolves into it",
	() => {
		mkdirSync(join(home, ".thinkrail", "context", "_work"), { recursive: true });
		symlinkSync(member, join(home, ".thinkrail", "context", "_work", "sneaky"), LINK_TYPE);
		for (const path of [
			"workspaces/thinkrail-feat/src/a.ts",
			"workspaces/thinkrail-feat/new.md",
			"@workspaces/thinkrail-feat/src/a.ts",
			join(home, "workspaces", "thinkrail-feat", "src", "a.ts"),
			join(member, "src", "a.ts"),
			".thinkrail/context/_work/sneaky/src/a.ts",
			"workspaces/new-folder/x.md",
		]) {
			expect(memberWriteTarget(path, home, home)).not.toBeNull();
		}
		for (const path of [
			".thinkrail/context/plan.md",
			".thinkrail/context/_work/notes.md",
			join(base, "elsewhere.md"),
			"workspaces-notes.md",
		]) {
			expect(memberWriteTarget(path, home, home)).toBeNull();
		}
	},
);

test.if(symlinks)(
	"an orchestrator's parent gets the rule, and write and edit into a member are blocked with a reason",
	() => {
		setOrchestratorHomeResolver((workspaceId) => (workspaceId === "orch" ? home : null));
		const orchestrator = load("orch");
		expect(orchestrator.sections()).toEqual({ [ORCHESTRATOR_SECTION]: ORCHESTRATOR_RULE });
		for (const tool of ["write", "edit"]) {
			expect(orchestrator.call(tool, "workspaces/thinkrail-feat/src/a.ts")).toMatchObject({
				block: true,
				reason: expect.stringContaining("workspaces/thinkrail-feat/src/a.ts"),
			});
		}
		expect(orchestrator.call("write", join(member, "src", "a.ts"))).toMatchObject({ block: true });
		expect(orchestrator.call("write", ".thinkrail/context/plan.md")).toBeUndefined();
		expect(orchestrator.call("edit", ".thinkrail/context/plan.md")).toBeUndefined();
		expect(orchestrator.call("read", "workspaces/thinkrail-feat/src/a.ts")).toBeUndefined();

		const child = load("orch", false);
		expect(child.sections()).toEqual({});
		expect(child.call("write", "workspaces/thinkrail-feat/src/a.ts")).toMatchObject({
			block: true,
		});

		const plain = load("w1");
		expect(plain.sections()).toEqual({});
		expect(plain.call("write", "workspaces/thinkrail-feat/src/a.ts")).toBeUndefined();
	},
);

test("a throwing resolver leaves the session unguarded rather than failing it", () => {
	setOrchestratorHomeResolver(() => {
		throw new Error("store unreadable");
	});
	const policy = load("orch");
	expect(policy.sections()).toEqual({});
	expect(policy.call("write", "workspaces/x/a.ts")).toBeUndefined();
});
