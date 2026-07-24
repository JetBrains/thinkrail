#!/usr/bin/env bun
// Canary for the compiled-binary seam (`registerBundledRuntime`, packages/server/src/agent/extensions.ts).
//
// pi deliberately hides Node-only provider code behind **bundler-opaque dynamic imports** (variable
// specifiers) so browser bundles can't follow them — but `bun build --compile` can't follow them either,
// and a single-file binary has no `node_modules` to resolve them from at runtime. That's how OAuth
// sign-in shipped broken (`Cannot find module './openai-codex.js' from '/$bunfs/...'`): the seam only
// fails inside the artifact, where no from-source suite can see it.
//
// This gate catches the *next* one at the cheapest possible point — the pi version bump itself: parse
// the pinned pi packages' `dist` (a real TypeScript AST, so comments, strings, and multiline formatting
// can't hide or fake a match) for dynamic `import(...)` whose specifier is not a constant string, and
// require the findings to match the allowlist below **exactly, per occurrence** (file + normalized
// specifier expression, as a multiset — not per file, so a bump that adds a second opaque import to an
// already-known file, or reshapes a known one, fails instead of hiding behind the file's entry).
//   - A NEW occurrence fails: verify it (register a static seam in `registerBundledRuntime`, or confirm
//     it only ever receives `node:` builtin specifiers, which a compiled binary resolves at runtime),
//     then allowlist it with that justification.
//   - A STALE entry also fails: pi moved, removed, or reshaped the import — re-verify the seam still
//     covers the replacement, then update the entry. Both directions keep the list honest.
//
// Known limitation (why the runtime layers still exist): this sees `import(...)` call sites, not data
// flow — a new *call site* of an existing wrapper (e.g. `dynamicImport("./x.js")` in `env-api-keys.js`)
// adds no `import(` occurrence. Reshaping the wrapper itself trips the exact match and forces
// re-verification; what flows through an unchanged wrapper is the job of the behavioral artifact gates
// (`smoke:binary`'s real OAuth probe + `bun run e2e:binary`).
//
// Scope: `@earendil-works/pi-coding-agent` + its `@earendil-works/*` dependencies (transitively) —
// resolved from the server package's module context, i.e. exactly the instances the binary bundles.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import ts from "typescript";

/**
 * Known bundler-opaque dynamic imports: file → the exact specifier expressions (normalized) of every
 * opaque `import(...)` in it, plus the verified justification (see header for the update protocol).
 */
const ALLOWLIST: Record<string, { reason: string; imports: string[] }> = {
	"pi-ai/dist/auth/oauth/load.js": {
		reason: "handled — registerBunOAuthFlows() registered in registerBundledRuntime",
		imports: ["__rewriteRelativeImportExtension(runtimeSpecifier)"],
	},
	"pi-ai/dist/api/bedrock-converse-stream.lazy.js": {
		reason: "handled — setBedrockProviderModule() registered in registerBundledRuntime",
		imports: ["__rewriteRelativeImportExtension(runtimeSpecifier)"],
	},
	"pi-ai/dist/auth/context.js": {
		reason:
			"safe — the importNodeModule wrapper only ever receives node: builtin specifiers " +
			"(a compiled binary resolves those at runtime)",
		imports: ["__rewriteRelativeImportExtension(specifier)"],
	},
	"pi-ai/dist/env-api-keys.js": {
		reason:
			"safe — the dynamicImport wrapper only ever receives node: builtin specifiers " +
			"(a compiled binary resolves those at runtime)",
		imports: ["__rewriteRelativeImportExtension(specifier)"],
	},
};

/** The package root (`.../node_modules/@earendil-works/<name>`) an entry file resolved under. */
function packageRoot(name: string, entry: string): string {
	const marker = `${sep}@earendil-works${sep}${name}${sep}`;
	const at = entry.lastIndexOf(marker);
	if (at < 0) throw new Error(`cannot locate package root for ${name} from ${entry}`);
	return entry.slice(0, at + marker.length - 1);
}

/** Every `.js` file under `dir`, recursively. */
function listJsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...listJsFiles(full));
		else if (full.endsWith(".js")) out.push(full);
	}
	return out;
}

/**
 * Every opaque dynamic import's normalized specifier expression in `source`, from the AST: a call whose
 * callee is the `import` keyword and whose specifier is not a constant string. A no-substitution
 * template literal counts as constant (the bundler resolves it statically, like esbuild); a template
 * *with* substitutions, or any other expression, is opaque.
 */
function opaqueImportsIn(fileName: string, source: string): string[] {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		false,
		ts.ScriptKind.JS,
	);
	const found: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const specifier = node.arguments[0];
			const isConstant =
				specifier !== undefined &&
				(ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier));
			if (!isConstant) {
				found.push(
					specifier ? specifier.getText(sourceFile).replace(/\s+/g, " ").trim() : "<no argument>",
				);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return found.sort();
}

// Resolve pi-coding-agent from the server package (the module context the binary bundles), then walk
// its `@earendil-works/*` dependency closure, each dep resolved from its dependent's own context — the
// very instances that end up inside the artifact. `Bun.resolveSync`, not `createRequire().resolve`:
// pi's exports maps carry only `types`/`import` conditions, so require-condition resolution is blocked.
const repoRoot = resolve(import.meta.dir, "..");
const roots = new Map<string, string>();
const queue: { name: string; root: string }[] = [];
const enqueue = (name: string, resolveFrom: string): void => {
	if (roots.has(name)) return;
	const root = packageRoot(name, Bun.resolveSync(`@earendil-works/${name}`, resolveFrom));
	roots.set(name, root);
	queue.push({ name, root });
};
enqueue("pi-coding-agent", join(repoRoot, "packages", "server"));
for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
	const { root } = next;
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
	};
	for (const dep of Object.keys(pkg.dependencies ?? {})) {
		if (dep.startsWith("@earendil-works/")) enqueue(dep.slice("@earendil-works/".length), root);
	}
}

const found = new Map<string, string[]>();
for (const [name, root] of roots) {
	for (const file of listJsFiles(join(root, "dist"))) {
		const source = readFileSync(file, "utf8");
		// Cheap pre-filter: only AST-parse files that mention a dynamic import at all.
		if (!/\bimport\s*\(/.test(source)) continue;
		const imports = opaqueImportsIn(file, source);
		if (imports.length === 0) continue;
		found.set(
			`${name}/${file
				.slice(root.length + 1)
				.split(sep)
				.join("/")}`,
			imports,
		);
	}
}

// Exact multiset comparison per file id, across the union of found + allowlisted ids: an occurrence in
// only one side is a drift. `unexpected` = in the tree but not allowlisted; `stale` = the reverse.
const unexpected: string[] = [];
const stale: string[] = [];
for (const id of new Set([...found.keys(), ...Object.keys(ALLOWLIST)])) {
	const actual = [...(found.get(id) ?? [])];
	const expected = [...(ALLOWLIST[id]?.imports ?? [])].sort();
	for (const imp of expected) {
		const at = actual.indexOf(imp);
		if (at >= 0) actual.splice(at, 1);
		else stale.push(`${id}: import(${imp})  (${ALLOWLIST[id]?.reason})`);
	}
	unexpected.push(...actual.map((imp) => `${id}: import(${imp})`));
}

if (unexpected.length > 0) {
	console.error(
		"check-binary-seams: NEW bundler-opaque dynamic import(s) in pi — the compiled binary cannot resolve these at runtime:",
	);
	for (const line of unexpected.sort()) console.error(`  - ${line}`);
	console.error(
		"\nVerify each one: register a static seam in registerBundledRuntime (packages/server/src/agent/extensions.ts),",
	);
	console.error(
		"or confirm it only receives node: builtins — then allowlist the occurrence in scripts/check-binary-seams.ts with that justification.",
	);
}
if (stale.length > 0) {
	console.error(
		"check-binary-seams: stale allowlist occurrence(s) — pi moved, removed, or reshaped these imports:",
	);
	for (const line of stale.sort()) console.error(`  - ${line}`);
	console.error(
		"\nRe-verify the seam still covers the replacement, then update the allowlist in scripts/check-binary-seams.ts.",
	);
}
if (unexpected.length > 0 || stale.length > 0) process.exit(1);

const occurrences = [...found.values()].reduce((n, imports) => n + imports.length, 0);
console.log(
	`check-binary-seams: OK (${occurrences} known opaque import occurrences in ${found.size} files across ${roots.size} pi packages, all handled or safe)`,
);
