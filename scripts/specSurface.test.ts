import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSpecSurfaceCheck } from "./check-spec-surface";
import {
	declaredNames,
	diffSurface,
	isBareNameList,
	PUBLIC_SURFACE_TAG,
	readSurfaceBlock,
} from "./specSurface";

const roots: string[] = [];

const BARE = `## Boundary

- **Owns:** the watcher registry.
- **Public surface (barrel):** \`ensureWatch\`, \`stopWatch\`,
  \`setWatchPublisher\`.
- **Allowed deps:** \`persistence\`, \`log\`.
`;

const PROSE = `- **Public surface (barrel):** \`initTransport\`, the three skill-load-safe session request
  wrappers, \`errorText\`.
- **Allowed deps:** \`contracts\`.
`;

const LABEL_FORMS = [
	"- **Public surface:** `Shell`.",
	"- **Public surface (barrel):** `readDir`.",
	"- **Public surface (barrel `index.ts`):** `LoginDialog`.",
	"- **Public surface (`index.ts`):** `HistoryIndex`.",
	"- **Owns / public surface (barrel):** `listTodos`.",
	"## Public surface",
];

const MENTION_ONLY = `- **Owns:** booting the host and opening the browser.
- **Forbidden:** reaching into the server's internals (use only its public surface), the browser
  bundle.
`;

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-spec-surface-"));
	roots.push(root);
	return root;
}

function write(root: string, path: string, content: string): void {
	const target = join(root, path);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, content);
}

function spec(id: string, surface: string, tags = `[${PUBLIC_SURFACE_TAG}]`): string {
	return `---
id: ${id}
type: module-design
title: ${id}
tags: ${tags}
---

## Boundary

${surface}
`;
}

function run(root: string, listSkipped = false) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const code = runSpecSurfaceCheck(root, {
		listSkipped,
		stdout: (line) => stdout.push(line),
		stderr: (line) => stderr.push(line),
	});
	return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

function surfaceOf(text: string) {
	const block = readSurfaceBlock(text);
	if (block === null) throw new Error("expected a public surface block");
	return block;
}

test("readSurfaceBlock stops at the next top-level bullet", () => {
	const block = readSurfaceBlock(BARE);
	expect(block?.heading).toBe(false);
	expect(block?.text).toContain("setWatchPublisher");
	expect(block?.text).not.toContain("Allowed deps");
});

test("readSurfaceBlock returns null when a spec declares no surface", () => {
	expect(readSurfaceBlock("- **Owns:** nothing worth naming.\n")).toBeNull();
});

test("readSurfaceBlock accepts every label form the specs write a surface as", () => {
	const declared = LABEL_FORMS.filter((line) => readSurfaceBlock(`${line}\n`) !== null);
	expect(declared).toEqual(LABEL_FORMS);
});

test("surface-like text in prose, frontmatter, and code blocks is ignored", () => {
	const text = `---
title: Public surface example
---

The module reaches a public surface.

~~~md
~~~not-a-close
- ~~~
- **Public surface:** \`wrong\`.
~~~

10. ~~~md
    - **Public surface:** \`listWrong\`.
    ~~~

- **Public surface:** \`right\`.
`;
	expect(declaredNames(surfaceOf(text))).toEqual(["right"]);
	expect(readSurfaceBlock(MENTION_ONLY)).toBeNull();
});

test("isBareNameList accepts names and rejects prose, signatures, and empty surfaces", () => {
	expect(isBareNameList(surfaceOf(BARE))).toBe(true);
	expect(isBareNameList(surfaceOf(PROSE))).toBe(false);
	expect(
		isBareNameList(
			surfaceOf("- **Public surface (barrel):** `listTodos({workspaceId}) → TodoPlan`.\n"),
		),
	).toBe(false);
	expect(isBareNameList(surfaceOf("- **Public surface (barrel):** none yet.\n"))).toBe(false);
});

test("declaredNames accepts type labels and ignores the bullet label", () => {
	const block = surfaceOf(
		"- **Public surface (barrel `index.ts`):** `openEditor`, `type WhichFn`, `pi-spec-graph/core`.\n",
	);
	expect(declaredNames(block)).toEqual(["WhichFn", "openEditor"]);
});

test("readSurfaceBlock keeps an indented sub-bullet inside the block", () => {
	const block = surfaceOf(
		"- **Public surface (barrel):** `alpha`,\n    - `beta`\n- **Allowed deps:** `gamma`.\n",
	);
	expect(isBareNameList(block)).toBe(true);
	expect(declaredNames(block)).toEqual(["alpha", "beta"]);
});

test("blank-separated paragraphs remain inside a public-surface list item", () => {
	const declaration =
		"- **Public surface:** `kept`,\n\n  `promised`.\n- **Allowed deps:** `outside`.\n";
	const block = surfaceOf(declaration);
	expect(isBareNameList(block)).toBe(true);
	expect(declaredNames(block)).toEqual(["kept", "promised"]);
	expect(block.text).not.toContain("Allowed deps");

	const root = fixture();
	write(root, "module/SPEC.md", spec("blank-continuation", declaration.trimEnd()));
	write(root, "module/index.ts", "export const kept = 1;\n");
	const result = run(root);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("barrel no longer exports: promised");
});

test("diffSurface reports both directions", () => {
	expect(diffSurface(["a", "b"], ["b", "c"])).toEqual({
		promised: ["a"],
		undeclared: ["c"],
	});
});

test("a tagged exact surface uses TypeScript's effective export names", () => {
	const root = fixture();
	write(
		root,
		"module/SPEC.md",
		spec(
			"module-effective",
			"- **Public surface (barrel):** `default`, `NamedDefault`, `OnlyType`, `renamed`, `tools`, `typeOnlyValue`.",
		),
	);
	write(
		root,
		"module/index.ts",
		`export type * from "./types";
export { value as renamed } from "./values";
export * as tools from "./values";
export { default as NamedDefault } from "./defaults";
export default function rootDefault() {}
`,
	);
	write(
		root,
		"module/types.ts",
		"export interface OnlyType { value: string }\nexport const typeOnlyValue = 1;\nexport default class HiddenDefault {}\n",
	);
	write(root, "module/values.ts", "export const value = 1;\n");
	write(root, "module/defaults.ts", "export default function targetDefault() {}\n");

	const result = run(root);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain("1 enrolled, 1 compared");
	expect(result.stderr).toBe("");
});

test("transitive star exports follow cycles without duplicating names", () => {
	const root = fixture();
	write(
		root,
		"module/SPEC.md",
		spec("module-cycle", "- **Public surface (barrel):** `alpha`, `Beta`."),
	);
	write(root, "module/index.ts", 'export * from "./a";\n');
	write(root, "module/a.ts", 'export * from "./b";\nexport const alpha = 1;\n');
	write(root, "module/b.ts", 'export * from "./a";\nexport interface Beta {}\n');

	expect(run(root)).toMatchObject({ code: 0, stderr: "" });
});

test("tagged structural failures cannot silently become skips", () => {
	const root = fixture();
	write(root, "missing/SPEC.md", spec("missing", "- **Owns:** nothing."));
	write(root, "missing/index.ts", "export const value = 1;\n");
	write(root, "prose/SPEC.md", spec("prose", PROSE.trim()));
	write(root, "prose/index.ts", "export const initTransport = 1;\n");
	write(root, "barrelless/SPEC.md", spec("barrelless", "- **Public surface:** `value`."));

	const result = run(root);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("tagged public-surface-checked but declares no public surface");
	expect(result.stderr).toContain("public surface is not a bare identifier list");
	expect(result.stderr).toContain("has no TypeScript barrel");
	expect(result.stdout).not.toContain("missing/SPEC.md");
});

test("surface differences report promises and undeclared exports", () => {
	const root = fixture();
	write(root, "module/SPEC.md", spec("module-diff", "- **Public surface:** `actual`, `promised`."));
	write(root, "module/index.ts", "export const actual = 1;\nexport const undeclared = 2;\n");

	const result = run(root);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("barrel no longer exports: promised");
	expect(result.stderr).toContain("surface does not list: undeclared");
});

test("direct and transitive unresolved re-exports fail", () => {
	const root = fixture();
	write(root, "direct/SPEC.md", spec("direct", "- **Public surface:** `value`."));
	write(root, "direct/index.ts", 'export { value } from "./missing";\n');
	write(root, "transitive/SPEC.md", spec("transitive", "- **Public surface:** `value`."));
	write(root, "transitive/index.ts", 'export * from "./middle";\n');
	write(root, "transitive/middle.ts", 'export * from "./missing";\n');

	const result = run(root);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("direct/index.ts → ./missing");
	expect(result.stderr).toContain("transitive/middle.ts → ./missing");
});

test("dependency and out-of-root declaration re-exports are validated", () => {
	const dependencyRoot = fixture();
	write(
		dependencyRoot,
		"package/tsconfig.json",
		JSON.stringify({
			compilerOptions: { module: "ESNext", moduleResolution: "Bundler", skipLibCheck: true },
			files: ["src/index.ts"],
		}),
	);
	write(
		dependencyRoot,
		"package/SPEC.md",
		spec("dependency-declarations", "- **Public surface:** `ok`."),
	);
	write(dependencyRoot, "package/src/index.ts", 'export * from "dep";\n');
	write(
		dependencyRoot,
		"package/node_modules/dep/package.json",
		JSON.stringify({ name: "dep", types: "index.d.ts" }),
	);
	write(
		dependencyRoot,
		"package/node_modules/dep/index.d.ts",
		'export const ok: number;\nexport * from "./missing";\n',
	);
	const dependencyResult = run(dependencyRoot);
	expect(dependencyResult.code).toBe(1);
	expect(dependencyResult.stderr).toContain("package/node_modules/dep/index.d.ts → ./missing");

	const outsideRoot = fixture();
	const outsideDeclarations = fixture();
	write(
		outsideRoot,
		"package/tsconfig.json",
		JSON.stringify({
			compilerOptions: {
				baseUrl: ".",
				module: "ESNext",
				moduleResolution: "Bundler",
				paths: { outside: [join(outsideDeclarations, "index.d.ts")] },
				skipLibCheck: true,
			},
			files: ["src/index.ts"],
		}),
	);
	write(
		outsideRoot,
		"package/SPEC.md",
		spec("outside-declarations", "- **Public surface:** `ok`."),
	);
	write(outsideRoot, "package/src/index.ts", 'export * from "outside";\n');
	write(
		outsideDeclarations,
		"index.d.ts",
		'export const ok: number;\nexport * from "./missing";\n',
	);
	const outsideResult = run(outsideRoot);
	expect(outsideResult.code).toBe(1);
	expect(outsideResult.stderr).toContain("index.d.ts → ./missing");
});

test("ambient-module re-export graphs are validated", () => {
	const root = fixture();
	write(
		root,
		"package/tsconfig.json",
		JSON.stringify({
			compilerOptions: {
				module: "ESNext",
				moduleResolution: "Bundler",
				skipLibCheck: true,
			},
			files: ["globals.d.ts", "src/index.ts"],
		}),
	);
	write(root, "package/SPEC.md", spec("ambient", "- **Public surface:** `x`."));
	write(root, "package/src/index.ts", 'export * from "foo";\n');
	write(
		root,
		"package/globals.d.ts",
		'declare module "foo" { export const x: number; export * from "missing-package"; }\n',
	);

	const result = run(root);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("package/globals.d.ts → missing-package");
});

test("merged ambient modules share explicit star precedence", () => {
	const root = fixture();
	write(
		root,
		"package/tsconfig.json",
		JSON.stringify({
			compilerOptions: { module: "ESNext", moduleResolution: "Bundler", skipLibCheck: true },
			files: ["globals.d.ts", "src/index.ts"],
		}),
	);
	write(root, "package/SPEC.md", spec("ambient-merged", "- **Public surface:** `shared`."));
	write(root, "package/src/index.ts", 'export * from "foo";\n');
	write(
		root,
		"package/globals.d.ts",
		`declare module "left" { export const shared: number }
declare module "right" { export const shared: number }
declare module "foo" { export * from "left"; export * from "right" }
declare module "foo" { export { shared } from "left" }
`,
	);

	expect(run(root)).toMatchObject({ code: 0, stderr: "" });
});

test("exported import-equals declarations resolve star precedence", () => {
	const root = fixture();
	write(
		root,
		"package/tsconfig.json",
		JSON.stringify({
			compilerOptions: { module: "CommonJS", moduleResolution: "Node10" },
			files: ["src/index.ts", "src/namespace.ts", "src/left.ts", "src/right.ts"],
		}),
	);
	write(root, "package/SPEC.md", spec("import-equals", "- **Public surface:** `Shared`."));
	write(
		root,
		"package/src/index.ts",
		'export import Shared = require("./namespace");\nexport * from "./left";\nexport * from "./right";\n',
	);
	write(root, "package/src/namespace.ts", "class Shared {}\nexport = Shared;\n");
	write(root, "package/src/left.ts", "export const Shared = 1;\n");
	write(root, "package/src/right.ts", "export const Shared = 2;\n");

	expect(run(root)).toMatchObject({ code: 0, stderr: "" });
});

test("direct CommonJS export assignments normalize to one default surface", () => {
	const root = fixture();
	write(
		root,
		"tsconfig.json",
		JSON.stringify({
			compilerOptions: { module: "CommonJS", moduleResolution: "Node10" },
			include: ["**/*.ts"],
		}),
	);
	write(root, "class/SPEC.md", spec("export-equals-class", "- **Public surface:** `default`."));
	write(root, "class/index.ts", "class Api {}\nexport = Api;\n");
	write(
		root,
		"function/SPEC.md",
		spec("export-equals-function", "- **Public surface:** `default`."),
	);
	write(root, "function/index.ts", "function api() {}\nexport = api;\n");
	write(root, "object/SPEC.md", spec("export-equals-object", "- **Public surface:** `default`."));
	write(root, "object/index.ts", "const api = { value: 1 };\nexport = api;\n");

	const result = run(root);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain("3 enrolled, 3 compared");

	const invalid = fixture();
	write(
		invalid,
		"module/tsconfig.json",
		JSON.stringify({
			compilerOptions: { module: "CommonJS", moduleResolution: "Node10" },
			files: ["index.ts"],
		}),
	);
	write(
		invalid,
		"module/SPEC.md",
		spec("export-equals-synthetic", "- **Public surface:** `prototype`."),
	);
	write(invalid, "module/index.ts", "class Api {}\nexport = Api;\n");

	const mismatch = run(invalid);
	expect(mismatch.code).toBe(1);
	expect(mismatch.stderr).toContain("barrel no longer exports: prototype");
	expect(mismatch.stderr).toContain("surface does not list: default");
});

test("module-valued exported aliases join transitive validation", () => {
	const root = fixture();
	write(
		root,
		"tsconfig.json",
		JSON.stringify({
			compilerOptions: { module: "CommonJS", moduleResolution: "Node10", skipLibCheck: true },
			files: ["globals.d.ts", "namespace/index.ts", "equals/index.ts"],
		}),
	);
	write(
		root,
		"globals.d.ts",
		'declare module "middle" { export const ok: number; export * from "missing-package"; }\n',
	);
	write(root, "namespace/SPEC.md", spec("namespace-alias", "- **Public surface:** `api`."));
	write(root, "namespace/index.ts", 'import * as api from "middle";\nexport { api };\n');
	write(root, "equals/SPEC.md", spec("import-equals-alias", "- **Public surface:** `api`."));
	write(root, "equals/index.ts", 'export import api = require("middle");\n');

	const result = run(root);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("namespace/SPEC.md");
	expect(result.stderr).toContain("equals/SPEC.md");
	expect(result.stderr).toContain("globals.d.ts → missing-package");
});

test("invalid named and ambiguous star re-exports fail", () => {
	const root = fixture();
	write(root, "named/SPEC.md", spec("named", "- **Public surface:** `Missing`."));
	write(root, "named/index.ts", 'export { Missing } from "./types";\n');
	write(root, "named/types.ts", "export interface Present {}\n");
	write(root, "ambiguous/SPEC.md", spec("ambiguous", "- **Public surface:** `shared`."));
	write(root, "ambiguous/index.ts", 'export * from "./left";\nexport * from "./right";\n');
	write(root, "ambiguous/left.ts", "export const shared = 1;\n");
	write(root, "ambiguous/right.ts", "export const shared = 2;\n");

	const result = run(root);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("TS2305");
	expect(result.stderr).toContain("TS2308");
});

test("alias and star validation survives TypeScript diagnostic suppression", () => {
	const root = fixture();
	write(
		root,
		"named/SPEC.md",
		spec("named-suppressed", "- **Public surface:** `Missing`, `Surface`."),
	);
	write(
		root,
		"named/index.ts",
		'// @ts-nocheck\nimport { Missing } from "./types";\nexport { Missing };\nexport { Present as Surface, Missing as Surface } from "./types";\n',
	);
	write(root, "named/types.ts", "export interface Present {}\n");
	write(root, "ambiguous/SPEC.md", spec("ambiguous-suppressed", "- **Public surface:** `shared`."));
	write(
		root,
		"ambiguous/index.ts",
		'// @ts-nocheck\nexport * from "./left";\nexport * from "./right";\n',
	);
	write(root, "ambiguous/left.ts", "export const shared = 1;\n");
	write(root, "ambiguous/right.ts", "export const shared = 2;\n");
	write(root, "duplicate/SPEC.md", spec("duplicate-suppressed", "- **Public surface:** `shared`."));
	write(
		root,
		"duplicate/index.ts",
		'// @ts-nocheck\nexport { left as shared } from "./left";\nexport { right as shared } from "./right";\n',
	);
	write(root, "duplicate/left.ts", "export const left = 1;\n");
	write(root, "duplicate/right.ts", "export const right = 2;\n");
	write(root, "direct/SPEC.md", spec("direct-suppressed", "- **Public surface:** `x`."));
	write(root, "direct/index.ts", "// @ts-nocheck\nexport const x = 1;\nexport { x };\n");

	const result = run(root);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("invalid exported alias in named/index.ts: Missing");
	expect(result.stderr).toContain("invalid export specifier in named/index.ts: Missing as Surface");
	expect(result.stderr).toContain("ambiguous star export in ambiguous/index.ts: shared");
	expect(result.stderr).toContain("duplicate explicit export in duplicate/index.ts: shared");
	expect(result.stderr).toContain("duplicate explicit export in direct/index.ts: x");
});

test("untagged specs remain successful skips and list only when requested", () => {
	const root = fixture();
	write(
		root,
		"module/SPEC.md",
		spec("module-unenrolled", "- **Public surface:** `promised`.", "[tooling]"),
	);
	write(root, "module/index.ts", 'export * from "./missing";\n');

	const quiet = run(root);
	expect(quiet.code).toBe(0);
	expect(quiet.stdout).not.toContain("module/SPEC.md");
	expect(quiet.stderr).toBe("");

	const listed = run(root, true);
	expect(listed.code).toBe(0);
	expect(listed.stdout).toContain("module/SPEC.md: not enrolled");
});

test("canonical scalar-tag specs at nonstandard Markdown paths can use src barrels", () => {
	const root = fixture();
	write(
		root,
		"package/MODULE.md",
		spec("module-nonstandard", "- **Public surface:** `value`.", PUBLIC_SURFACE_TAG),
	);
	write(root, "package/src/index.ts", "export const value = 1;\n");
	write(
		root,
		"invalid/SPEC.md",
		`---
title: invalid
tags: [${PUBLIC_SURFACE_TAG}]
---

- **Public surface:** \`ghost\`.
`,
	);

	const result = run(root, true);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain("1 enrolled, 1 compared");
	expect(result.stdout).not.toContain("invalid/SPEC.md");
});

test("nearest tsconfig options participate in module resolution", () => {
	const root = fixture();
	write(
		root,
		"package/tsconfig.json",
		JSON.stringify({
			compilerOptions: {
				baseUrl: ".",
				module: "ESNext",
				moduleResolution: "Bundler",
				paths: { "#types": ["src/types.ts"] },
			},
		}),
	);
	write(root, "package/SPEC.md", spec("module-paths", "- **Public surface:** `Resolved`."));
	write(root, "package/src/index.ts", 'export type { Resolved } from "#types";\n');
	write(root, "package/src/types.ts", "export interface Resolved {}\n");

	expect(run(root)).toMatchObject({ code: 0, stderr: "" });
});
