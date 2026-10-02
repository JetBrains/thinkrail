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
	"packages/pi-background-commands": "pi-background-commands",
	"packages/pi-subagents": "pi-subagents",
	"packages/pi-dag": "pi-dag",
	"pi-extensions/visualize": "@thinkrail.ai/pi-visualize",
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
		"packages/pi-dag": { "pi-delegation": "workspace:*" },
		"packages/server": {
			"@thinkrail/contracts": "workspace:*",
			"@thinkrail/shared": "workspace:*",
			"pi-delegation": "workspace:*",
			"pi-background-commands": "workspace:*",
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
		'import "pi-delegation"; import "pi-subagents"; import "pi-background-commands"; export * from "@thinkrail/contracts";',
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

test("keeps DAG orchestration portable and out of delegation and the unbundled host", () => {
	const root = fixture();
	write(root, "packages/pi-dag/index.ts", 'export * from "pi-delegation";');
	expect(moduleBoundaryViolations(root)).toEqual([]);
	write(root, "packages/pi-dag/leak.ts", 'import "@thinkrail/server"; import "pi-subagents";');
	write(root, "packages/pi-delegation/leak.ts", 'import "pi-dag";');
	write(root, "packages/server/dag.ts", 'import "pi-dag";');
	expect(moduleBoundaryViolations(root)).toEqual([
		'packages/pi-dag/leak.ts: import "@thinkrail/server" creates forbidden packages/pi-dag -> packages/server edge',
		'packages/pi-dag/leak.ts: import "pi-subagents" creates forbidden packages/pi-dag -> packages/pi-subagents edge',
		'packages/pi-delegation/leak.ts: import "pi-dag" creates forbidden packages/pi-delegation -> packages/pi-dag edge',
		'packages/server/dag.ts: import "pi-dag" creates forbidden packages/server -> packages/pi-dag edge',
	]);
});

test("keeps background commands portable and out of browser imports", () => {
	const root = fixture();
	write(root, "packages/pi-background-commands/src/leak.ts", 'import "@thinkrail/server";');
	write(root, "packages/pi-background-commands/src/delegation.ts", 'import "pi-delegation";');
	write(
		root,
		"apps/web/src/commandLeak.ts",
		'import type { Command } from "pi-background-commands";',
	);
	expect(moduleBoundaryViolations(root)).toEqual([
		'apps/web/src/commandLeak.ts: import "pi-background-commands" creates forbidden apps/web -> packages/pi-background-commands edge',
		'packages/pi-background-commands/src/delegation.ts: import "pi-delegation" creates forbidden packages/pi-background-commands -> packages/pi-delegation edge',
		'packages/pi-background-commands/src/leak.ts: import "@thinkrail/server" creates forbidden packages/pi-background-commands -> packages/server edge',
	]);
});

test("keeps published pi packages free of host imports and unwired from the host until their wiring PR", () => {
	const root = fixture();
	write(root, "pi-extensions/visualize/index.ts", 'import { Type } from "typebox";');
	expect(moduleBoundaryViolations(root)).toEqual([]);
	write(
		root,
		"pi-extensions/visualize/src/leak.ts",
		'import "@thinkrail/server"; import "pi-delegation";',
	);
	write(root, "packages/server/src/early.ts", 'import "@thinkrail.ai/pi-visualize";');
	write(
		root,
		"apps/web/src/early.ts",
		'import type { VisualizeParams } from "@thinkrail.ai/pi-visualize";',
	);
	expect(moduleBoundaryViolations(root)).toEqual([
		'apps/web/src/early.ts: import "@thinkrail.ai/pi-visualize" creates forbidden apps/web -> pi-extensions/visualize edge',
		'packages/server/src/early.ts: import "@thinkrail.ai/pi-visualize" creates forbidden packages/server -> pi-extensions/visualize edge',
		'pi-extensions/visualize/src/leak.ts: import "@thinkrail/server" creates forbidden pi-extensions/visualize -> packages/server edge',
		'pi-extensions/visualize/src/leak.ts: import "pi-delegation" creates forbidden pi-extensions/visualize -> packages/pi-delegation edge',
	]);
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

function sdkFixture(): string {
	const root = fixture();
	for (const [moduleRoot, name] of Object.entries({
		"packages/ui": "@thinkrail/ui",
		"packages/extension-api": "@thinkrail/extension-api",
		"pi-extensions/future": "@thinkrail.ai/pi-future",
		"thinkrail-extensions/future": "@thinkrail/ext-future",
		"thinkrail-extensions/another": "@thinkrail/ext-another",
	})) {
		write(root, `${moduleRoot}/package.json`, JSON.stringify({ name }));
	}
	return root;
}

const importForms = [
	["side effect", (s: string) => `import "${s}";`],
	["type import", (s: string) => `import type { Value } from "${s}";`],
	["inline type", (s: string) => `import { type Value } from "${s}";`],
	["re-export", (s: string) => `export * from "${s}";`],
	["type re-export", (s: string) => `export type { Value } from "${s}";`],
	["inline type re-export", (s: string) => `export { type Value } from "${s}";`],
	["dynamic import", (s: string) => `void import("${s}");`],
	["template import", (s: string) => `void import(\`${s}\`);`],
	["require", (s: string) => `require("${s}");`],
	["import equals", (s: string) => `import value = require("${s}");`],
	["import type expression", (s: string) => `type Value = import("${s}").Value;`],
] as const;

test.each(importForms)("rejects extension half crossings via %s", (_label, source) => {
	const root = sdkFixture();
	for (const [from, to] of [
		["web", "server"],
		["server", "web"],
	] as const) {
		for (const [kind, specifier] of [
			["relative", `../../${to}/index`],
			["public", `@thinkrail/ext-future/${to}`],
			["deep", `@thinkrail/ext-future/${to}/internal`],
			["traversal", `@thinkrail/ext-future/${from}/../${to}/index`],
		] as const) {
			write(root, `thinkrail-extensions/future/${from}/nested/${kind}.ts`, source(specifier));
		}
	}
	const violations = moduleBoundaryViolations(root);
	expect(violations).toHaveLength(8);
	for (const violation of violations) expect(violation).toContain("source halves");
});

const hostEntryLeaks = [
	"",
	"/web",
	"/server",
	"/web/internal",
	"/server/internal",
	"/web/../server",
	"/web/index.ts",
	"/server/index.ts",
];

for (const [host, entry, relativeBase] of [
	["apps/web", "web", "../../../thinkrail-extensions"],
	["packages/server", "server", "../../../thinkrail-extensions"],
] as const) {
	test.each(
		hostEntryLeaks.filter((suffix) => suffix !== `/${entry}`),
	)(`${host} rejects extension entry %s`, (suffix) => {
		const root = sdkFixture();
		const specifier = `@thinkrail/ext-future${suffix}`;
		write(root, `${host}/src/leak.ts`, `export type { Value } from "${specifier}";`);
		const violations = moduleBoundaryViolations(root);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain(`only public @thinkrail/ext-future/${entry}`);
	});
	test(`${host} rejects relative imports even into the correct extension half`, () => {
		const root = sdkFixture();
		write(root, `${host}/src/leak.ts`, `require("${relativeBase}/future/${entry}/index");`);
		const violations = moduleBoundaryViolations(root);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain(`only public @thinkrail/ext-future/${entry}`);
	});
}

test("discovers new pi and ThinkRail extensions and rejects host and sibling dependencies", () => {
	const root = sdkFixture();
	write(root, "pi-extensions/future/leak.ts", 'import "@thinkrail/server";');
	write(root, "thinkrail-extensions/another/web/leak.ts", 'import "@thinkrail/web";');
	write(root, "thinkrail-extensions/future/server/leak.ts", 'import "@thinkrail/server";');
	write(
		root,
		"thinkrail-extensions/future/web/pi.ts",
		'import type { Value } from "@thinkrail.ai/pi-future";',
	);
	write(
		root,
		"thinkrail-extensions/future/server/sibling.ts",
		'import "@thinkrail.ai/pi-visualize";',
	);
	expect(moduleBoundaryViolations(root)).toHaveLength(5);
});

test.each([
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
])("checks discovered SDK and extension manifest %s edges", (section) => {
	const root = sdkFixture();
	for (const [moduleRoot, name] of Object.entries({
		"packages/ui": "@thinkrail/ui",
		"packages/extension-api": "@thinkrail/extension-api",
		"pi-extensions/future": "@thinkrail.ai/pi-future",
		"thinkrail-extensions/future": "@thinkrail/ext-future",
	})) {
		write(
			root,
			`${moduleRoot}/package.json`,
			JSON.stringify({
				name,
				[section]: { "@thinkrail/web": "workspace:*" },
			}),
		);
	}
	expect(moduleBoundaryViolations(root)).toHaveLength(4);
});

test("SDK sources cannot reach host internals or each other", () => {
	const root = sdkFixture();
	write(
		root,
		"packages/ui/src/leak.ts",
		'import "@thinkrail/web"; import "@thinkrail/extension-api/server";',
	);
	write(
		root,
		"packages/extension-api/src/leak.ts",
		'export * from "@thinkrail/ui"; import "@thinkrail/server";',
	);
	expect(moduleBoundaryViolations(root)).toHaveLength(4);
});

for (const [file, relativeSpecifier] of [
	["apps/web/src/leak.ts", "../../../packages/extension-api/src/web"],
	["thinkrail-extensions/future/web/leak.ts", "../../../packages/extension-api/src/web"],
] as const) {
	test.each([
		"",
		"/server",
		"/web/helpers",
		"/web/../server",
	])(`${file} rejects extension-api entry %s`, (suffix) => {
		const root = sdkFixture();
		write(root, file, `export * from "@thinkrail/extension-api${suffix}";`);
		const violations = moduleBoundaryViolations(root);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("only public @thinkrail/extension-api/web");
	});
	test(`${file} rejects extension-api relative bypass`, () => {
		const root = sdkFixture();
		write(root, file, `import type { Value } from "${relativeSpecifier}";`);
		expect(moduleBoundaryViolations(root)).toHaveLength(1);
	});
}

test.each([
	["src/web.ts", "./server"],
	["src/web/helpers.ts", "../server/index"],
	["web/index.ts", "../server/index"],
	["src/helpers.ts", "@thinkrail/extension-api/server"],
])("extension-api %s cannot leak its server half", (file, specifier) => {
	const root = sdkFixture();
	write(root, `packages/extension-api/${file}`, `export type { Value } from "${specifier}";`);
	const violations = moduleBoundaryViolations(root);
	expect(violations).toHaveLength(1);
	expect(violations[0]).toContain("server half");
});

const runtimePiImports = [
	'import { value } from "@earendil-works/pi-ai";',
	'import { type Value, value } from "@earendil-works/pi-ai";',
	'import value, { type Value } from "@earendil-works/pi-ai";',
	'export { type Value, value } from "@earendil-works/pi-ai";',
	'export * from "@earendil-works/pi-coding-agent";',
	'export * as pi from "@earendil-works/pi-ai";',
	'import "@earendil-works/pi-agent-core";',
	'void import("@earendil-works/pi-ai");',
	'require("@earendil-works/pi-coding-agent");',
	'import pi = require("@earendil-works/pi-ai");',
	'import "@mariozechner/pi-ai";',
	'import "pi-web-access";',
];

test.each([
	"apps/web/src/leak.ts",
	"packages/ui/src/leak.ts",
	"packages/contracts/src/leak.ts",
	"packages/extension-api/src/web.ts",
	"packages/extension-api/src/server.ts",
	"thinkrail-extensions/future/web/leak.ts",
])("%s rejects pi runtime imports but accepts explicit external pi types", (file) => {
	const root = sdkFixture();
	write(root, file, runtimePiImports.join("\n"));
	const violations = moduleBoundaryViolations(root);
	expect(violations).toHaveLength(runtimePiImports.length);
	for (const violation of violations) expect(violation).toContain("pi value import");
	write(
		root,
		file,
		[
			'import type { Value } from "@earendil-works/pi-ai";',
			'import { type Value } from "@earendil-works/pi-ai";',
			'export type { Value } from "@earendil-works/pi-ai";',
			'export { type Value } from "@earendil-works/pi-ai";',
			'export type * from "@earendil-works/pi-ai";',
			'import type Value = require("@earendil-works/pi-ai");',
			'type Value = import("@earendil-works/pi-ai").Value;',
			'type Value = typeof import("@earendil-works/pi-ai");',
		].join("\n"),
	);
	expect(moduleBoundaryViolations(root)).toEqual([]);
});

test("accepts SDK edges, extension manifest unions, same-half sources, and public host entries", () => {
	const root = sdkFixture();
	for (const [moduleRoot, name, dependencies] of [
		["packages/ui", "@thinkrail/ui", ["@thinkrail/contracts"]],
		["packages/extension-api", "@thinkrail/extension-api", ["@thinkrail/contracts"]],
		[
			"thinkrail-extensions/future",
			"@thinkrail/ext-future",
			[
				"@thinkrail/ui",
				"@thinkrail/extension-api",
				"@thinkrail/contracts",
				"@thinkrail.ai/pi-future",
			],
		],
		[
			"apps/web",
			"@thinkrail/web",
			[
				"@thinkrail/ui",
				"@thinkrail/extension-api",
				"@thinkrail/contracts",
				"@thinkrail/ext-future",
			],
		],
		["packages/server", "@thinkrail/server", ["@thinkrail/extension-api", "@thinkrail/ext-future"]],
	] as const) {
		write(
			root,
			`${moduleRoot}/package.json`,
			JSON.stringify({
				name,
				dependencies: Object.fromEntries(dependencies.map((name) => [name, "workspace:*"])),
			}),
		);
	}
	write(root, "packages/ui/src/index.ts", 'export type { Value } from "@thinkrail/contracts";');
	write(
		root,
		"packages/extension-api/src/web.ts",
		'import "@thinkrail/contracts"; import "./helpers";',
	);
	write(
		root,
		"packages/extension-api/src/server.ts",
		'import type { Value } from "@earendil-works/pi-coding-agent";',
	);
	write(
		root,
		"thinkrail-extensions/future/web/index.ts",
		'import "@thinkrail/ui/dialog"; import "@thinkrail/extension-api/web"; import "@thinkrail/contracts"; import "./component";',
	);
	write(
		root,
		"thinkrail-extensions/future/web/component.tsx",
		'export * from "@thinkrail/ext-future/web/helpers";',
	);
	write(
		root,
		"thinkrail-extensions/future/server/index.ts",
		'import "@thinkrail/extension-api/server"; import "@thinkrail.ai/pi-future"; import "@earendil-works/pi-coding-agent"; import "./helpers";',
	);
	write(
		root,
		"apps/web/src/registry.ts",
		'import "@thinkrail/ext-future/web"; import "@thinkrail/ext-another/web"; import "@thinkrail/ui"; import "@thinkrail/ui/dialog"; import "@thinkrail/extension-api/web";',
	);
	write(
		root,
		"packages/server/src/registry.ts",
		'import "@thinkrail/ext-future/server"; import "@thinkrail/ext-another/server"; import "@thinkrail/extension-api/server";',
	);
	expect(moduleBoundaryViolations(root)).toEqual([]);
});
