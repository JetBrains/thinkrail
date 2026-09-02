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

\`\`\`md
- **Public surface:** \`wrong\`.
\`\`\`

    - **Public surface:** \`alsoWrong\`.

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
		"- **Public surface (barrel):** `alpha`,\n  - `beta`\n- **Allowed deps:** `gamma`.\n",
	);
	expect(isBareNameList(block)).toBe(true);
	expect(declaredNames(block)).toEqual(["alpha", "beta"]);
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
