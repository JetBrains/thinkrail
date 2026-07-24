#!/usr/bin/env bun
// Canary for the compiled-binary seam (`registerBundledRuntime`, packages/server/src/agent/extensions.ts).
//
// pi deliberately hides Node-only provider code behind **bundler-opaque dynamic imports** (variable
// specifiers) so browser bundles can't follow them — but `bun build --compile` can't follow them either,
// and a single-file binary has no `node_modules` to resolve them from at runtime. That's how OAuth
// sign-in shipped broken (`Cannot find module './openai-codex.js' from '/$bunfs/...'`): the seam only
// fails inside the artifact, where no from-source suite can see it.
//
// This gate catches the *next* one at the cheapest possible point — the pi version bump itself: scan the
// pinned pi packages' `dist` for non-literal `import(...)` and require the findings to match the
// allowlist below **exactly, per occurrence** (file + whitespace-normalized argument expression, as a
// multiset — not per file, so a bump that adds a second opaque import to an already-known file, or
// reshapes a known one, fails instead of hiding behind the file's existing entry).
//   - A NEW occurrence fails: verify it (register a static seam in `registerBundledRuntime`, or confirm
//     it only ever receives `node:` builtin specifiers, which a compiled binary resolves at runtime),
//     then allowlist it with that justification.
//   - A STALE entry also fails: pi moved, removed, or reshaped the import — re-verify the seam still
//     covers the replacement, then update the entry. Both directions keep the list honest.
//
// Known limitation (why the runtime layers still exist): this sees `import(...)` call sites, not data
// flow — a new *call site* of an existing wrapper (e.g. `dynamicImport("./x.js")` in `env-api-keys.js`)
// adds no `import(` occurrence. Reshaping the wrapper itself trips the exact match and forces
// re-verification; what slips past a wrapper is the job of the behavioral artifact gates
// (`smoke:binary`'s real OAuth probe + `bun run e2e:binary`).
//
// Scope: `@earendil-works/pi-coding-agent` + its `@earendil-works/*` dependencies, resolved from the
// server package's module context — exactly the instances the binary bundles.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Known bundler-opaque dynamic imports: file → the exact argument expressions (normalized) of every
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

/**
 * A non-literal dynamic import: `import(` whose argument does not start with a plain quote (so variable
 * specifiers AND template literals are flagged), excluding method calls like jiti's `.import(...)`.
 */
const OPAQUE_IMPORT = /(?<![.\w$])import\s*\(\s*[^"'\s)]/g;

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

/** The argument expression starting at `from` (just past `import(`), captured to its balanced `)`. */
function captureArgument(line: string, from: number): string {
	let depth = 1;
	for (let i = from; i < line.length; i++) {
		const ch = line[i];
		if (ch === "(") depth++;
		else if (ch === ")" && --depth === 0) return line.slice(from, i);
	}
	return line.slice(from); // unbalanced by line end — the truncated tail is still a stable fingerprint
}

/** Every opaque dynamic import's normalized argument expression on non-comment lines of `file`. */
function opaqueImportsIn(file: string): string[] {
	const found: string[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
		for (const match of line.matchAll(OPAQUE_IMPORT)) {
			const argStart = line.indexOf("(", match.index) + 1;
			found.push(captureArgument(line, argStart).replace(/\s+/g, " ").trim());
		}
	}
	return found.sort();
}

// Resolve pi-coding-agent from the server package (the module context the binary bundles), then its
// scoped deps from pi-coding-agent's own context — the very instances that end up inside the artifact.
// `Bun.resolveSync`, not `createRequire().resolve`: pi's exports maps carry only `types`/`import`
// conditions, so require-condition resolution is blocked.
const repoRoot = resolve(import.meta.dir, "..");
const codingAgentEntry = Bun.resolveSync(
	"@earendil-works/pi-coding-agent",
	join(repoRoot, "packages", "server"),
);
const codingAgentRoot = packageRoot("pi-coding-agent", codingAgentEntry);

const roots = new Map<string, string>([["pi-coding-agent", codingAgentRoot]]);
const codingAgentPkg = JSON.parse(readFileSync(join(codingAgentRoot, "package.json"), "utf8")) as {
	dependencies?: Record<string, string>;
};
for (const dep of Object.keys(codingAgentPkg.dependencies ?? {})) {
	if (!dep.startsWith("@earendil-works/")) continue;
	const name = dep.slice("@earendil-works/".length);
	roots.set(name, packageRoot(name, Bun.resolveSync(dep, codingAgentRoot)));
}

const found = new Map<string, string[]>();
for (const [name, root] of roots) {
	for (const file of listJsFiles(join(root, "dist"))) {
		const imports = opaqueImportsIn(file);
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
