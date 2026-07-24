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
// allowlist below **exactly**.
//   - A NEW match fails: verify it (register a static seam in `registerBundledRuntime`, or confirm it
//     only imports `node:` builtins, which a compiled binary resolves at runtime), then allowlist it
//     with that justification.
//   - A STALE entry also fails: pi moved/removed the file — re-verify the seam still covers the
//     replacement, then update the entry. Both directions keep the list honest.
//
// Scope: `@earendil-works/pi-coding-agent` + its `@earendil-works/*` dependencies, resolved from the
// server package's module context — exactly the instances the binary bundles.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** Known bundler-opaque dynamic imports, each verified handled-or-safe (see header for the protocol). */
const ALLOWLIST: Record<string, string> = {
	"pi-ai/dist/auth/oauth/load.js":
		"handled — registerBunOAuthFlows() registered in registerBundledRuntime",
	"pi-ai/dist/api/bedrock-converse-stream.lazy.js":
		"handled — setBedrockProviderModule() registered in registerBundledRuntime",
	"pi-ai/dist/auth/context.js":
		"safe — imports node: builtins only (a compiled binary resolves those at runtime)",
	"pi-ai/dist/env-api-keys.js":
		"safe — imports node: builtins only (a compiled binary resolves those at runtime)",
};

/**
 * A non-literal dynamic import: `import(` whose argument does not start with a plain quote (so variable
 * specifiers AND template literals are flagged), excluding method calls like jiti's `.import(...)`.
 */
const OPAQUE_IMPORT = /(?<![.\w$])import\s*\(\s*[^"'\s)]/;

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

/** True when a non-comment line contains a bundler-opaque dynamic import. */
function hasOpaqueImport(file: string): boolean {
	return readFileSync(file, "utf8")
		.split("\n")
		.some((line) => {
			const trimmed = line.trimStart();
			if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*"))
				return false;
			return OPAQUE_IMPORT.test(line);
		});
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

const found = new Set<string>();
for (const [name, root] of roots) {
	for (const file of listJsFiles(join(root, "dist"))) {
		if (!hasOpaqueImport(file)) continue;
		found.add(
			`${name}/${file
				.slice(root.length + 1)
				.split(sep)
				.join("/")}`,
		);
	}
}

const unexpected = [...found].filter((id) => !(id in ALLOWLIST)).sort();
const stale = Object.keys(ALLOWLIST)
	.filter((id) => !found.has(id))
	.sort();

if (unexpected.length > 0) {
	console.error(
		"check-binary-seams: NEW bundler-opaque dynamic import(s) in pi — the compiled binary cannot resolve these at runtime:",
	);
	for (const id of unexpected) console.error(`  - ${id}`);
	console.error(
		"\nVerify each one: register a static seam in registerBundledRuntime (packages/server/src/agent/extensions.ts),",
	);
	console.error(
		"or confirm it only imports node: builtins — then allowlist it in scripts/check-binary-seams.ts with that justification.",
	);
}
if (stale.length > 0) {
	console.error(
		"check-binary-seams: stale allowlist entr(y/ies) — pi moved or removed these files:",
	);
	for (const id of stale) console.error(`  - ${id} (${ALLOWLIST[id]})`);
	console.error(
		"\nRe-verify the seam still covers the replacement, then update the allowlist in scripts/check-binary-seams.ts.",
	);
}
if (unexpected.length > 0 || stale.length > 0) process.exit(1);

console.log(
	`check-binary-seams: OK (${found.size} known opaque imports across ${roots.size} pi packages, all handled or safe)`,
);
