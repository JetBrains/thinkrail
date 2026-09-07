import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleBoundaryViolations } from "./check-module-boundaries";

const roots: string[] = [];

const modules = {
	"packages/artifact-tests": "@thinkrail/artifact-tests",
	"packages/contracts": "@thinkrail/contracts",
	"packages/shared": "@thinkrail/shared",
	"packages/pi-delegation": "pi-delegation",
	"packages/pi-subagents": "pi-subagents",
	"packages/server": "@thinkrail/server",
	"apps/web": "@thinkrail/web",
	"apps/cli": "@thinkrail/cli",
	"apps/desktop": "@thinkrail/desktop",
} as const;

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, content: string): void {
	const target = join(root, path);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, content);
}

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-module-boundaries-"));
	roots.push(root);
	const dependencies: Record<string, Record<string, string>> = {
		"packages/artifact-tests": {
			"@thinkrail/cli": "workspace:*",
			"@thinkrail/server": "workspace:*",
			"@thinkrail/shared": "workspace:*",
		},
		"packages/shared": { "@thinkrail/contracts": "workspace:*" },
		"packages/pi-subagents": { "pi-delegation": "workspace:*" },
		"packages/server": {
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/shared": "workspace:*",
			"pi-delegation": "workspace:*",
			"pi-subagents": "workspace:*",
		},
		"apps/web": { "@thinkrail/contracts": "workspace:*" },
		"apps/cli": {
			"@thinkrail/server": "workspace:*",
			"@thinkrail/shared": "workspace:*",
		},
		"apps/desktop": {
			"@thinkrail/server": "workspace:*",
			"@thinkrail/shared": "workspace:*",
		},
	};
	for (const [moduleRoot, name] of Object.entries(modules)) {
		write(
			root,
			`${moduleRoot}/package.json`,
			JSON.stringify({ name, dependencies: dependencies[moduleRoot] ?? {} }),
		);
	}
	return root;
}

test("accepts the declared package rings and thin launcher edges", () => {
	const root = fixture();
	write(
		root,
		"packages/shared/src/value.ts",
		'import type { Project } from "@thinkrail/contracts";',
	);
	write(root, "packages/pi-subagents/src/value.ts", 'export * from "pi-delegation";');
	write(
		root,
		"packages/server/src/value.ts",
		'import "pi-delegation"; import "pi-subagents"; export * from "@thinkrail/contracts";',
	);
	write(root, "apps/web/src/value.tsx", 'import type { Project } from "@thinkrail/contracts";');
	write(root, "apps/cli/src/value.ts", 'import { bootHost } from "@thinkrail/server";');
	write(
		root,
		"packages/artifact-tests/src/value.ts",
		'import "@thinkrail/server/history-test-fixtures"; import "@thinkrail/cli/artifact";',
	);
	write(
		root,
		"apps/desktop/src/value.ts",
		'const host = import("@thinkrail/server/build-support");',
	);

	expect(moduleBoundaryViolations(root)).toEqual([]);
});

test("keeps artifact test infrastructure out of product code", () => {
	const root = fixture();
	write(root, "apps/desktop/src/testLeak.ts", 'import "@thinkrail/artifact-tests";');
	write(root, "packages/server/src/testLeak.ts", 'import "@thinkrail/artifact-tests";');
	write(root, "packages/artifact-tests/src/webLeak.ts", 'import "@thinkrail/web";');
	expect(moduleBoundaryViolations(root)).toEqual([
		'apps/desktop/src/testLeak.ts: import "@thinkrail/artifact-tests" creates forbidden apps/desktop -> packages/artifact-tests edge',
		'packages/artifact-tests/src/webLeak.ts: import "@thinkrail/web" creates forbidden packages/artifact-tests -> apps/web edge',
		'packages/server/src/testLeak.ts: import "@thinkrail/artifact-tests" creates forbidden packages/server -> packages/artifact-tests edge',
	]);
});

test("ignores generated framework files without excluding desktop source", () => {
	const root = fixture();
	write(root, "apps/desktop/.hutch/devkit/api/example.ts", 'import "@thinkrail/web";');
	write(root, "apps/desktop/.cottontail-tmp/loader.mjs", 'import "@thinkrail/web";');
	write(root, "apps/desktop/src/example.ts", 'import "@thinkrail/web";');

	expect(moduleBoundaryViolations(root)).toEqual([
		'apps/desktop/src/example.ts: import "@thinkrail/web" creates forbidden apps/desktop -> apps/web edge',
	]);
});

test("rejects manifest, type-only, dynamic, CommonJS, and relative cross-boundary edges", () => {
	const root = fixture();
	write(
		root,
		"apps/desktop/package.json",
		JSON.stringify({
			name: "@thinkrail/desktop",
			dependencies: {
				"@thinkrail/server": "workspace:*",
				"@thinkrail/shared": "workspace:*",
				"@thinkrail/web": "workspace:*",
			},
		}),
	);
	write(
		root,
		"apps/web/src/typeLeak.ts",
		'import type { RunningServer } from "@thinkrail/server";',
	);
	write(root, "apps/web/src/commonJsLeak.cjs", 'require("@thinkrail/server");');
	write(root, "apps/cli/src/dynamicLeak.ts", 'void import("@thinkrail/web");');
	write(root, "packages/shared/src/relativeLeak.ts", 'export * from "../../server/src/index";');
	write(root, "packages/pi-delegation/src/leak.ts", 'import "pi-subagents";');

	expect(moduleBoundaryViolations(root)).toEqual([
		'apps/cli/src/dynamicLeak.ts: import "@thinkrail/web" creates forbidden apps/cli -> apps/web edge',
		"apps/desktop/package.json: dependencies.@thinkrail/web creates forbidden apps/desktop -> apps/web edge",
		'apps/web/src/commonJsLeak.cjs: import "@thinkrail/server" creates forbidden apps/web -> packages/server edge',
		'apps/web/src/typeLeak.ts: import "@thinkrail/server" creates forbidden apps/web -> packages/server edge',
		'packages/pi-delegation/src/leak.ts: import "pi-subagents" creates forbidden packages/pi-delegation -> packages/pi-subagents edge',
		'packages/shared/src/relativeLeak.ts: import "../../server/src/index" creates forbidden packages/shared -> packages/server edge',
	]);
});
