import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookConfigFile } from "@thinkrail/contracts";
import { loadHookConfig, resolveHookCommand, resolveHookRun, writeHookConfig } from "./config";

let worktree: string;

beforeEach(() => {
	worktree = mkdtempSync(join(tmpdir(), "trpi-hooks-config-test-"));
});

afterEach(() => {
	rmSync(worktree, { recursive: true, force: true });
});

const DEFAULT_CONFIG: HookConfigFile = { version: 1, combineMode: "both", hooks: {} };

function writeRawHooksJson(value: unknown): void {
	mkdirSync(join(worktree, ".thinkrail"), { recursive: true });
	writeFileSync(join(worktree, ".thinkrail", "hooks.json"), JSON.stringify(value));
}

// --- loadHookConfig -----------------------------------------------------------------------

test("loadHookConfig returns the default config when .thinkrail/hooks.json doesn't exist", () => {
	expect(loadHookConfig(worktree)).toEqual(DEFAULT_CONFIG);
});

test("loadHookConfig: a legacy flat file (no version/hooks keys) back-compats into a versioned config wrapping it as hooks", () => {
	writeRawHooksJson({ onCreate: "npm i" });
	expect(loadHookConfig(worktree)).toEqual({
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "npm i" },
	});
});

test("loadHookConfig: a new-shape file round-trips as-is", () => {
	const config: HookConfigFile = {
		version: 1,
		combineMode: "local",
		hooks: {
			onCreate: { command: "npm i" },
			onDelete: { script: ".thinkrail/hooks/teardown.sh" },
		},
	};
	writeRawHooksJson(config);
	expect(loadHookConfig(worktree)).toEqual(config);
});

test('loadHookConfig: a new-shape file missing combineMode defaults it to "both"', () => {
	writeRawHooksJson({ hooks: { onCreate: "npm i" } });
	expect(loadHookConfig(worktree)).toEqual({
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "npm i" },
	});
});

test("loadHookConfig returns the default config on malformed JSON rather than throwing", () => {
	mkdirSync(join(worktree, ".thinkrail"), { recursive: true });
	writeFileSync(join(worktree, ".thinkrail", "hooks.json"), "{ not json");
	expect(loadHookConfig(worktree)).toEqual(DEFAULT_CONFIG);
});

test("loadHookConfig returns the default config when the file is valid JSON but not an object (e.g. an array)", () => {
	writeRawHooksJson([1, 2, 3]);
	expect(loadHookConfig(worktree)).toEqual(DEFAULT_CONFIG);
});

// --- writeHookConfig -----------------------------------------------------------------------

test("writeHookConfig creates .thinkrail/ and writes the given versioned config as pretty JSON", () => {
	const config: HookConfigFile = {
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "npm install" },
	};
	writeHookConfig(worktree, config);
	expect(loadHookConfig(worktree)).toEqual(config);
});

test("writeHookConfig round-trips combineMode and script values", () => {
	const config: HookConfigFile = {
		version: 1,
		combineMode: "shared",
		hooks: { onDelete: { script: ".thinkrail/hooks/teardown.sh" } },
	};
	writeHookConfig(worktree, config);
	expect(loadHookConfig(worktree)).toEqual(config);
});

test("writeHookConfig overwrites a prior file entirely (not a merge)", () => {
	writeHookConfig(worktree, {
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "npm install", onDelete: "echo bye" },
	});
	writeHookConfig(worktree, {
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "pnpm install" },
	});
	expect(loadHookConfig(worktree)).toEqual({
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "pnpm install" },
	});
});

test("writeHookConfig with an empty hooks map still writes a file, not leaving it missing", () => {
	writeHookConfig(worktree, {
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "npm install" },
	});
	writeHookConfig(worktree, { version: 1, combineMode: "both", hooks: {} });
	expect(existsSync(join(worktree, ".thinkrail", "hooks.json"))).toBe(true);
	expect(loadHookConfig(worktree)).toEqual({ version: 1, combineMode: "both", hooks: {} });
});

// --- resolveHookCommand (legacy; still called by hooks.ts/handlers.ts until later tasks) --------

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

// --- resolveHookRun -----------------------------------------------------------------------

test('resolveHookRun: mode "both" returns [shared, local] in that order when both tiers declare the hook', () => {
	const committed: HookConfigFile = {
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "npm i" },
	};
	const local = { onCreate: "echo local-extra" };
	const result = resolveHookRun({
		hook: "onCreate",
		committed,
		local,
		mode: "both",
		basePath: worktree,
	});
	expect(result).toEqual([
		{
			source: "shared",
			kind: "inline",
			exec: "npm i",
			display: "npm i",
			approvalMaterial: "npm i",
		},
		{
			source: "local",
			kind: "inline",
			exec: "echo local-extra",
			display: "echo local-extra",
			approvalMaterial: "echo local-extra",
		},
	]);
});

test('resolveHookRun: mode "shared" returns only the shared entry, ignoring local', () => {
	const committed: HookConfigFile = {
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "npm i" },
	};
	const local = { onCreate: "echo local-extra" };
	const result = resolveHookRun({
		hook: "onCreate",
		committed,
		local,
		mode: "shared",
		basePath: worktree,
	});
	expect(result).toEqual([
		{
			source: "shared",
			kind: "inline",
			exec: "npm i",
			display: "npm i",
			approvalMaterial: "npm i",
		},
	]);
});

test('resolveHookRun: mode "local" returns only the local entry, ignoring shared', () => {
	const committed: HookConfigFile = {
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "npm i" },
	};
	const local = { onCreate: "echo local-extra" };
	const result = resolveHookRun({
		hook: "onCreate",
		committed,
		local,
		mode: "local",
		basePath: worktree,
	});
	expect(result).toEqual([
		{
			source: "local",
			kind: "inline",
			exec: "echo local-extra",
			display: "echo local-extra",
			approvalMaterial: "echo local-extra",
		},
	]);
});

test('resolveHookRun: mode "both" skips a tier that doesn\'t declare the hook', () => {
	const committed: HookConfigFile = {
		version: 1,
		combineMode: "both",
		hooks: { onCreate: "npm i" },
	};
	const result = resolveHookRun({
		hook: "onCreate",
		committed,
		local: {},
		mode: "both",
		basePath: worktree,
	});
	expect(result).toEqual([
		{
			source: "shared",
			kind: "inline",
			exec: "npm i",
			display: "npm i",
			approvalMaterial: "npm i",
		},
	]);
});

test("resolveHookRun: returns [] when neither tier declares the hook", () => {
	const committed: HookConfigFile = { version: 1, combineMode: "both", hooks: {} };
	const result = resolveHookRun({
		hook: "preMerge",
		committed,
		local: {},
		mode: "both",
		basePath: worktree,
	});
	expect(result).toEqual([]);
});

test("resolveHookRun: a {command} object value yields the same inline entry as an equivalent bare string", () => {
	const committed: HookConfigFile = {
		version: 1,
		combineMode: "shared",
		hooks: { onCreate: { command: "npm i" } },
	};
	const result = resolveHookRun({
		hook: "onCreate",
		committed,
		local: {},
		mode: "shared",
		basePath: worktree,
	});
	expect(result).toEqual([
		{
			source: "shared",
			kind: "inline",
			exec: "npm i",
			display: "npm i",
			approvalMaterial: "npm i",
		},
	]);
});

test("resolveHookRun: a shared {script} path resolves against basePath, with the file's contents as approvalMaterial", () => {
	mkdirSync(join(worktree, ".thinkrail", "hooks"), { recursive: true });
	writeFileSync(join(worktree, ".thinkrail", "hooks", "setup.sh"), "#!/bin/sh\necho hi\n");
	const committed: HookConfigFile = {
		version: 1,
		combineMode: "shared",
		hooks: { onCreate: { script: ".thinkrail/hooks/setup.sh" } },
	};
	const result = resolveHookRun({
		hook: "onCreate",
		committed,
		local: {},
		mode: "shared",
		basePath: worktree,
	});
	expect(result).toEqual([
		{
			source: "shared",
			kind: "script",
			exec: join(worktree, ".thinkrail/hooks/setup.sh"),
			display: "script: .thinkrail/hooks/setup.sh",
			approvalMaterial: "#!/bin/sh\necho hi\n",
		},
	]);
});

test("resolveHookRun: a relative local {script} path also resolves against basePath", () => {
	mkdirSync(join(worktree, "scripts"), { recursive: true });
	writeFileSync(join(worktree, "scripts", "teardown.sh"), "echo teardown\n");
	const local = { onDelete: { script: "scripts/teardown.sh" } };
	const committed: HookConfigFile = { version: 1, combineMode: "local", hooks: {} };
	const result = resolveHookRun({
		hook: "onDelete",
		committed,
		local,
		mode: "local",
		basePath: worktree,
	});
	expect(result).toEqual([
		{
			source: "local",
			kind: "script",
			exec: join(worktree, "scripts/teardown.sh"),
			display: "script: scripts/teardown.sh",
			approvalMaterial: "echo teardown\n",
		},
	]);
});

test("resolveHookRun: an absolute local {script} path is used as-is, not joined with basePath", () => {
	const scriptDir = mkdtempSync(join(tmpdir(), "trpi-hooks-config-abs-script-"));
	const scriptPath = join(scriptDir, "abs-setup.sh");
	writeFileSync(scriptPath, "echo abs\n");
	try {
		const local = { onCreate: { script: scriptPath } };
		const committed: HookConfigFile = { version: 1, combineMode: "local", hooks: {} };
		const result = resolveHookRun({
			hook: "onCreate",
			committed,
			local,
			mode: "local",
			basePath: worktree, // a different dir entirely — proves the absolute path isn't joined against it
		});
		expect(result).toEqual([
			{
				source: "local",
				kind: "script",
				exec: scriptPath,
				display: `script: ${scriptPath}`,
				approvalMaterial: "echo abs\n",
			},
		]);
	} finally {
		rmSync(scriptDir, { recursive: true, force: true });
	}
});

test("resolveHookRun: a missing script file resolves with missing:true and approvalMaterial:null, without throwing", () => {
	const committed: HookConfigFile = {
		version: 1,
		combineMode: "shared",
		hooks: { onCreate: { script: ".thinkrail/hooks/missing.sh" } },
	};
	const result = resolveHookRun({
		hook: "onCreate",
		committed,
		local: {},
		mode: "shared",
		basePath: worktree,
	});
	expect(result).toEqual([
		{
			source: "shared",
			kind: "script",
			exec: join(worktree, ".thinkrail/hooks/missing.sh"),
			display: "script: .thinkrail/hooks/missing.sh",
			approvalMaterial: null,
			missing: true,
		},
	]);
});
