// File CRUD over pi's two sanctioned prompt-template directories (global + project-scoped). Frontmatter
// is pi's own convention (`description` / `argument-hint`, pinned in SPEC.md against pi v0.80.6); this
// module owns the traversal gate (`isValidTemplateName`) that pi's own loader doesn't provide. `content`
// is always the full file text (frontmatter + body) — the wire's `TemplateInfo.content` contract — never
// pi's parsed/stripped body. See SPEC.md for the pinned pi facts and the freshness rationale.
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	type Stats,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { TemplateInfo, TemplateScope } from "@thinkrail/contracts";

/** The two sanctioned template directories. `projectDir` is absent whenever there's no workspace. */
export interface TemplateDirs {
	globalDir: string;
	projectDir?: string;
}

/**
 * The traversal gate: every caller-supplied name is checked against this before it's used to build a
 * path (`${name}.md` under one of the sanctioned dirs). This is a **path-traversal safety check, not a
 * naming-style rule** — pi's own loader derives a template's name from the filename alone
 * (`basename(filePath).replace(/\.md$/, "")`, with no sanitization at all — see SPEC.md's pinned pi
 * facts), so this gate must accept every name pi could legally list, or `listTemplates` and the by-name
 * operations fall out of parity: a name that shows up in a listing but can't be fetched, overwritten, or
 * deleted by that same name is a user-visible bug, not a safety win. (An earlier version of this gate
 * used an `/^[a-z0-9][a-z0-9-_]*$/i` allowlist regex — safe, but over-restrictive: it rejected any name
 * with an interior dot, e.g. "foo.bar", which pi itself lists without complaint.)
 *
 * Rejected — exactly the shapes that are unsafe as a single filename segment:
 * - empty string
 * - a leading "." (covers ".", "..", and dotfiles like ".hidden" with one rule)
 * - a path separator anywhere in the name ("/" or "\" — blocks "a/b", "../x", absolute paths, and
 *   Windows-style separators)
 * - an embedded NUL byte
 *
 * Everything else — interior dots, uppercase, spaces, unicode — is accepted.
 */
export function isValidTemplateName(name: string): boolean {
	if (name.length === 0) return false;
	if (name.startsWith(".")) return false;
	return !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

/** The global + (if `cwd` is given) project prompt directories, pi's own layout: `<agentDir>/prompts`
 * and `<cwd>/.pi/prompts`. Pure path arithmetic — no filesystem access. `agentDir`'s default is a
 * call-time expression (not a cached module-level constant): `getAgentDir()` reads
 * `PI_CODING_AGENT_DIR` live, so a test that sets the env var right before calling this must see it. */
export function templateDirs(cwd?: string, agentDir: string = getAgentDir()): TemplateDirs {
	return {
		globalDir: join(agentDir, "prompts"),
		...(cwd ? { projectDir: join(cwd, CONFIG_DIR_NAME, "prompts") } : {}),
	};
}

/** The directory for `scope`. Throws for "project" when no workspace is available. */
function dirForScope(dirs: TemplateDirs, scope: TemplateScope): string {
	if (scope === "project") {
		if (!dirs.projectDir)
			throw new Error('template scope "project" requires a workspace (projectDir)');
		return dirs.projectDir;
	}
	return dirs.globalDir;
}

/** `lstat` that never follows a symlink and never throws — `null` for a missing path. */
function lstatOrNull(path: string): Stats | null {
	try {
		return lstatSync(path);
	} catch {
		return null;
	}
}

/**
 * The **no-follow gate** (see SPEC.md): a directory entry named `<name>.md` that isn't a regular file —
 * a symlink first of all — is *not a template*, for every by-name operation alike. pi's own read-only
 * scanner deliberately follows file symlinks; this write-capable CRUD surface deliberately does not — a
 * checked-out repo's `.pi/prompts/linked.md → ~/somewhere` must never be disclosed by `template.get` or
 * overwritten by `template.save`. (`lstat`, never `stat`/`existsSync`, so the check itself can't follow.)
 */
function isRegularFile(path: string): boolean {
	return lstatOrNull(path)?.isFile() ?? false;
}

/** The dir-level half of the no-follow gate, for **project-scope writes** only: the repo controls
 * `<cwd>/.pi` and `<cwd>/.pi/prompts`, so a symlinked component there is the same escape one level up
 * (`saveTemplate` would `mkdir`/write, `deleteTemplate` would `rm`, inside the link's target). The
 * global dir is exempt on purpose — it's user-owned, and dotfile managers routinely symlink it. */
function assertProjectWriteSafe(dirs: TemplateDirs, scope: TemplateScope): void {
	if (scope !== "project" || !dirs.projectDir) return;
	for (const dir of [dirname(dirs.projectDir), dirs.projectDir]) {
		if (lstatOrNull(dir)?.isSymbolicLink()) {
			throw new Error(`refusing to write templates through a symlinked directory: ${dir}`);
		}
	}
}

/** Read + parse one template file from `dir`. `null` if it doesn't exist — or exists but isn't a
 * regular file (the no-follow gate above; a symlinked entry is absent to every by-name operation, the
 * same way `listDir`'s dirent `isFile()` already hides it from listings). Propagates a frontmatter
 * parse failure — a directly-named lookup deserves to know the file itself is broken. */
function readTemplateFile(dir: string, scope: TemplateScope, name: string): TemplateInfo | null {
	const filePath = join(dir, `${name}.md`);
	if (!isRegularFile(filePath)) return null;
	const content = readFileSync(filePath, "utf-8");
	const { frontmatter } = parseFrontmatter(content);
	const description =
		typeof frontmatter.description === "string" ? frontmatter.description : undefined;
	const argumentHint =
		typeof frontmatter["argument-hint"] === "string" ? frontmatter["argument-hint"] : undefined;
	return {
		name,
		...(description ? { description } : {}),
		...(argumentHint ? { argumentHint } : {}),
		content,
		scope,
		filePath,
	};
}

/** Every `.md` file directly inside `dir` (non-recursive) whose derived name passes
 * `isValidTemplateName`, as `TemplateInfo`s. Reusing that exact gate (not a hand-rolled dot check) is
 * what makes list/get parity structurally guaranteed rather than true by coincidence: whatever this
 * lists, `getTemplate`/`saveTemplate`/`deleteTemplate` can always act on by that same name, and the two
 * can never drift apart since they share one predicate. This is a deliberate divergence from pi's own
 * scanner (`loadTemplatesFromDir`), which has no such filter — pi would happily list a hand-placed
 * `.hidden.md` — done in service of *our* parity invariant, not something pi does for us.
 *
 * A per-file read/parse failure (malformed frontmatter, unreadable file) is caught and that one file is
 * skipped, not fatal — one bad file must never blank the whole listing. The *directory scan itself*
 * (`readdirSync` and the loop around it) is wrapped too: an unreadable directory (EACCES, or — the
 * deterministic case exercised in tests — a path that isn't actually a directory) is treated the same
 * way, mirroring pi's own `loadTemplatesFromDir`'s try/catch-the-whole-scan shape (distinct from
 * `loadTemplateFromFile`'s narrower per-file catch, which guards a different failure — see SPEC.md).
 * Missing/absent `dir` → empty, checked before any of this. */
function listDir(dir: string | undefined, scope: TemplateScope): TemplateInfo[] {
	if (!dir || !existsSync(dir)) return [];
	const templates: TemplateInfo[] = [];
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const name = entry.name.replace(/\.md$/, "");
			if (!isValidTemplateName(name)) continue;
			try {
				const template = readTemplateFile(dir, scope, name);
				if (template) templates.push(template);
			} catch {
				// Malformed frontmatter or an unreadable file — skip it, don't fail the whole list.
			}
		}
	} catch {
		// The directory itself couldn't be scanned — same "one bad thing never blanks everything" policy,
		// one level up: return whatever's already been collected (nothing, in practice, since a failing
		// readdirSync throws before yielding any entry).
	}
	return templates;
}

/** All templates from both dirs, project entries shadowing same-named global ones (design spec §2.2 —
 * this is a product decision, not something pi's own loader resolves for us; see SPEC.md). Always a
 * fresh `readdir` — never cached (the "/ menu freshness" rule, SPEC.md). Sorted by name. */
export function listTemplates(dirs: TemplateDirs): TemplateInfo[] {
	const byName = new Map<string, TemplateInfo>();
	for (const template of listDir(dirs.globalDir, "global")) byName.set(template.name, template);
	for (const template of listDir(dirs.projectDir, "project")) byName.set(template.name, template);
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch one template by name. `scope` omitted → project wins over global (same precedence as
 * `listTemplates`); an explicit `scope` reads exactly that dir. Throws if absent, if `name` is invalid,
 * or if `scope` is "project" with no workspace. */
export function getTemplate(dirs: TemplateDirs, name: string, scope?: TemplateScope): TemplateInfo {
	if (!isValidTemplateName(name)) throw new Error(`invalid template name: ${JSON.stringify(name)}`);
	if (scope) {
		const template = readTemplateFile(dirForScope(dirs, scope), scope, name);
		if (!template) throw new Error(`template not found: ${name} (scope: ${scope})`);
		return template;
	}
	if (dirs.projectDir) {
		const projectTemplate = readTemplateFile(dirs.projectDir, "project", name);
		if (projectTemplate) return projectTemplate;
	}
	const globalTemplate = readTemplateFile(dirs.globalDir, "global", name);
	if (globalTemplate) return globalTemplate;
	throw new Error(`template not found: ${name}`);
}

/** Create or overwrite a template. Writes `content` verbatim (the caller assembles frontmatter + body;
 * this module never rewrites it) and creates the scope's dir if missing. Throws on an invalid `name`, a
 * "project" scope with no workspace, or — checked BEFORE anything touches disk — malformed frontmatter in
 * `content` (an unparseable `---`-fenced block throws inside `parseFrontmatter`; validating first means a
 * rejected save writes nothing, instead of landing an orphan file that's invisible to `listTemplates`
 * (swallowed there) and un-`get`-able (throws there) once it exists). After a successful write, the
 * read-back used to build the return value can in principle still fail, but only for a filesystem race,
 * not a content problem — an acceptable residual this function doesn't try to eliminate. */
export function saveTemplate(
	dirs: TemplateDirs,
	scope: TemplateScope,
	name: string,
	content: string,
): TemplateInfo {
	if (!isValidTemplateName(name)) throw new Error(`invalid template name: ${JSON.stringify(name)}`);
	try {
		parseFrontmatter(content);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`invalid frontmatter: ${message}`);
	}
	const dir = dirForScope(dirs, scope);
	assertProjectWriteSafe(dirs, scope);
	const filePath = join(dir, `${name}.md`);
	// The file-level no-follow gate: `writeFileSync` follows an existing symlink, which would land the
	// write on its target — refuse loudly instead of clobbering whatever a checked-out repo pointed at.
	const existing = lstatOrNull(filePath);
	if (existing && !existing.isFile()) {
		throw new Error(`refusing to write through a non-regular file: ${name}.md`);
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, content, "utf-8");
	const template = readTemplateFile(dir, scope, name);
	if (!template) throw new Error(`failed to save template: ${name}`);
	return template;
}

/** Delete a template. Throws on an invalid `name`, a "project" scope with no workspace, or if the
 * template doesn't exist — a missing file is treated as an error, not a silent no-op, since a delete
 * request implies the caller's view already named a specific file; loud beats silent for a UI that might
 * be looking at a stale list (see SPEC.md's "Get right"). */
export function deleteTemplate(dirs: TemplateDirs, scope: TemplateScope, name: string): void {
	if (!isValidTemplateName(name)) throw new Error(`invalid template name: ${JSON.stringify(name)}`);
	const dir = dirForScope(dirs, scope);
	assertProjectWriteSafe(dirs, scope);
	const filePath = join(dir, `${name}.md`);
	// No-follow gate: a symlinked entry is not a template (never listed, never fetched), so a delete by
	// its name is a not-found, same as get — not an action on the link.
	if (!isRegularFile(filePath)) throw new Error(`template not found: ${name} (scope: ${scope})`);
	rmSync(filePath);
}
