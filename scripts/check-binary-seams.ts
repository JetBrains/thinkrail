#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
	isCallExpression,
	isNoSubstitutionTemplateLiteral,
	isStringLiteral,
	type Node,
	type SourceFile,
	SyntaxKind,
} from "typescript/unstable/ast";
import { parseFiles } from "./tsProjects";

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

const SKIPPED_DIST_DIRS: Record<string, string> = {
	"pi-coding-agent/dist/bundle":
		"CLI/RPC-only bundled runtime (reachable only via pi's bin and the ./rpc-entry export) — " +
		"the in-process library import ('.' → dist/index.js) never loads it, so its opaque imports " +
		"(content-hashed chunk duplicates of the allowlisted modular seams) never run in the compiled binary",
};

function packageRoot(name: string, entry: string): string {
	const marker = `${sep}@earendil-works${sep}${name}${sep}`;
	const at = entry.lastIndexOf(marker);
	if (at < 0) throw new Error(`cannot locate package root for ${name} from ${entry}`);
	return entry.slice(0, at + marker.length - 1);
}

function listJsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...listJsFiles(full));
		else if (full.endsWith(".js")) out.push(full);
	}
	return out;
}

function opaqueImportsIn(sourceFile: SourceFile): string[] {
	const found: string[] = [];
	const visit = (node: Node): void => {
		if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
			const specifier = node.arguments[0];
			const isConstant =
				specifier !== undefined &&
				(isStringLiteral(specifier) || isNoSubstitutionTemplateLiteral(specifier));
			if (!isConstant) {
				found.push(
					specifier ? specifier.getText(sourceFile).replace(/\s+/g, " ").trim() : "<no argument>",
				);
			}
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return found.sort();
}

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

const candidates: { id: string; file: string }[] = [];
const usedSkips = new Set<string>();
for (const [name, root] of roots) {
	for (const file of listJsFiles(join(root, "dist"))) {
		const id = `${name}/${file
			.slice(root.length + 1)
			.split(sep)
			.join("/")}`;
		const skipped = Object.keys(SKIPPED_DIST_DIRS).find((dir) => id.startsWith(`${dir}/`));
		if (skipped !== undefined) {
			usedSkips.add(skipped);
			continue;
		}
		if (!/\bimport\s*\(/.test(readFileSync(file, "utf8"))) continue;
		candidates.push({ id, file });
	}
}

const found = new Map<string, string[]>();
await parseFiles(
	repoRoot,
	candidates.map((candidate) => candidate.file),
	async (parsed) => {
		for (const { id, file } of candidates) {
			const imports = opaqueImportsIn(await parsed(file));
			if (imports.length > 0) found.set(id, imports);
		}
	},
);

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
for (const [dir, reason] of Object.entries(SKIPPED_DIST_DIRS)) {
	if (!usedSkips.has(dir)) stale.push(`${dir}: skipped dist dir no longer present  (${reason})`);
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
