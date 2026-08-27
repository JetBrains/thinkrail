import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleBoundaryViolations } from "./check-module-boundaries";

const roots: string[] = [];

const modules = {
	"packages/contracts": "@thinkrail/contracts",
	"packages/shared": "@thinkrail/shared",
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
		"packages/shared": { "@thinkrail/contracts": "workspace:*" },
		"packages/server": {
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/shared": "workspace:*",
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

test("accepts the contracts-server-web rings and thin launcher edges", () => {
	const root = fixture();
	write(
		root,
		"packages/shared/src/value.ts",
		'import type { Project } from "@thinkrail/contracts";',
	);
	write(root, "packages/server/src/value.ts", 'export * from "@thinkrail/contracts";');
	write(root, "apps/web/src/value.tsx", 'import type { Project } from "@thinkrail/contracts";');
	write(root, "apps/cli/src/value.ts", 'import { bootHost } from "@thinkrail/server";');
	write(
		root,
		"apps/desktop/src/value.ts",
		'const host = import("@thinkrail/server/build-support");',
	);

	expect(moduleBoundaryViolations(root)).toEqual([]);
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

	expect(moduleBoundaryViolations(root)).toEqual([
		'apps/cli/src/dynamicLeak.ts: import "@thinkrail/web" creates forbidden apps/cli -> apps/web edge',
		"apps/desktop/package.json: dependencies.@thinkrail/web creates forbidden apps/desktop -> apps/web edge",
		'apps/web/src/commonJsLeak.cjs: import "@thinkrail/server" creates forbidden apps/web -> packages/server edge',
		'apps/web/src/typeLeak.ts: import "@thinkrail/server" creates forbidden apps/web -> packages/server edge',
		'packages/shared/src/relativeLeak.ts: import "../../server/src/index" creates forbidden packages/shared -> packages/server edge',
	]);
});
