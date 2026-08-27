import { expect, test } from "bun:test";
import {
	declaredNames,
	diffSurface,
	isBareNameList,
	parseExports,
	readSurfaceBlock,
} from "./specSurface";

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

test("a bullet that only mentions the public surface in its body declares nothing", () => {
	expect(readSurfaceBlock(MENTION_ONLY)).toBeNull();
});

test("isBareNameList accepts a list of names and rejects prose", () => {
	expect(isBareNameList(surfaceOf(BARE))).toBe(true);
	expect(isBareNameList(surfaceOf(PROSE))).toBe(false);
});

test("isBareNameList rejects a surface that names nothing", () => {
	expect(isBareNameList(surfaceOf("- **Public surface (barrel):** none yet.\n"))).toBe(false);
});

test("declaredNames drops the type keyword and anything that is not an identifier", () => {
	const block = surfaceOf(
		"- **Public surface (barrel):** `openEditor`, `type WhichFn`, `pi-spec-graph/core`.\n",
	);
	expect(declaredNames(block)).toEqual(["openEditor", "WhichFn"]);
});

test("parseExports reads named, aliased, type-only and declared exports", () => {
	const parsed = parseExports(`
export { alpha, type Beta, gamma as delta } from "./one";
export type { Epsilon } from "./two";
export function zeta() {}
export const eta = 1;
export default eta;
`);
	expect(parsed.names.sort()).toEqual(["Beta", "Epsilon", "alpha", "delta", "eta", "zeta"]);
	expect(parsed.starTargets).toEqual([]);
});

test("parseExports reports star targets and names a star namespace", () => {
	const parsed = parseExports(`export * from "./watch";\nexport * as theta from "./iota";\n`);
	expect(parsed.starTargets).toEqual(["./watch"]);
	expect(parsed.names).toEqual(["theta"]);
});

test("diffSurface reports both directions", () => {
	expect(diffSurface(["a", "b"], ["b", "c"])).toEqual({ promised: ["a"], undeclared: ["c"] });
});

test("parseExports ignores exports inside comments and string literals", () => {
	const parsed = parseExports(`
// export { ghost } from "./nowhere";
/* export const phantom = 1; */
const sample = 'export { alsoGhost } from "./nowhere";';
export const real = sample;
`);
	expect(parsed.names).toEqual(["real"]);
	expect(parsed.starTargets).toEqual([]);
});

test("parseExports treats a type-only star as a star target", () => {
	expect(parseExports(`export type * from "./types";\n`).starTargets).toEqual(["./types"]);
});

test("parseExports names a const enum rather than its keyword", () => {
	expect(parseExports("export const enum Mode { A }\n").names).toEqual(["Mode"]);
});

test("declaredNames ignores an identifier inside the bullet's own label", () => {
	const block = surfaceOf("- **Public surface (barrel `index.ts`):** `openEditor`.\n");
	expect(declaredNames(block)).toEqual(["openEditor"]);
});

test("readSurfaceBlock keeps an indented sub-bullet inside the block", () => {
	const block = surfaceOf(
		"- **Public surface (barrel):** `alpha`,\n  - `beta`\n- **Allowed deps:** `gamma`.\n",
	);
	expect(isBareNameList(block)).toBe(true);
	expect(declaredNames(block).sort()).toEqual(["alpha", "beta"]);
});

test("a prose mention never shadows the bullet that declares the surface", () => {
	const block = surfaceOf(
		"Siblings reach it only through its public surface.\n\n- **Public surface (barrel):** `alpha`.\n",
	);
	expect(declaredNames(block)).toEqual(["alpha"]);
});

test("parseExports keeps an exported default declaration out of the surface", () => {
	expect(parseExports("export default function hidden() {}\n").names).toEqual([]);
});

test("isBareNameList rejects a surface written in signature style", () => {
	const block = surfaceOf(
		"- **Public surface (barrel):** `listTodos({workspaceId}) → TodoPlan`.\n",
	);
	expect(isBareNameList(block)).toBe(false);
});

test("a prose line only declares the surface when it opens with the phrase", () => {
	expect(readSurfaceBlock("The CI job runs the declared public surface check.\n")).toBeNull();
	expect(declaredNames(surfaceOf("Public surface: the `alpha` export.\n"))).toEqual(["alpha"]);
});
