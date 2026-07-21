// File CRUD over pi's two sanctioned prompt-template directories (global + project-scoped). Frontmatter
// is pi's own convention (`description` / `argument-hint`, pinned in SPEC.md against pi v0.80.6); this
// module owns the traversal gate (`isValidTemplateName`) that pi's own loader doesn't provide. `content`
// is always the full file text (frontmatter + body) — the wire's `TemplateInfo.content` contract — never
// pi's parsed/stripped body. See SPEC.md for the pinned pi facts and the freshness rationale.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { TemplateInfo, TemplateScope } from "@thinkrail/contracts";

/** The two sanctioned template directories. `projectDir` is absent whenever there's no workspace. */
export interface TemplateDirs {
	globalDir: string;
	projectDir?: string;
}

/** The traversal gate: every caller-supplied name is checked against this before it's joined into a
 * path. A plain slug — no `/`, no leading `.` (so `.`, `..`, and `.hidden` all fail), non-empty. */
const VALID_NAME = /^[a-z0-9][a-z0-9-_]*$/i;

/** Whether `name` is safe to use as a template filename (minus the `.md` suffix). */
export function isValidTemplateName(name: string): boolean {
	return VALID_NAME.test(name);
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

/** Read + parse one template file from `dir`. `null` if it doesn't exist. Propagates a frontmatter
 * parse failure — a directly-named lookup deserves to know the file itself is broken. */
function readTemplateFile(dir: string, scope: TemplateScope, name: string): TemplateInfo | null {
	const filePath = join(dir, `${name}.md`);
	if (!existsSync(filePath)) return null;
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

/** Every `.md` file directly inside `dir` (non-recursive), as `TemplateInfo`s. A file that fails to
 * read or parse is skipped, not fatal — one bad file must never blank the whole listing (pi's own
 * loader is equally tolerant). Missing/absent `dir` → empty. */
function listDir(dir: string | undefined, scope: TemplateScope): TemplateInfo[] {
	if (!dir || !existsSync(dir)) return [];
	const templates: TemplateInfo[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const name = entry.name.replace(/\.md$/, "");
		try {
			const template = readTemplateFile(dir, scope, name);
			if (template) templates.push(template);
		} catch {
			// Malformed frontmatter or an unreadable file — skip it, don't fail the whole list.
		}
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
 * this module never rewrites it) and creates the scope's dir if missing. Throws on an invalid `name` or
 * a "project" scope with no workspace. */
export function saveTemplate(
	dirs: TemplateDirs,
	scope: TemplateScope,
	name: string,
	content: string,
): TemplateInfo {
	if (!isValidTemplateName(name)) throw new Error(`invalid template name: ${JSON.stringify(name)}`);
	const dir = dirForScope(dirs, scope);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${name}.md`), content, "utf-8");
	const template = readTemplateFile(dir, scope, name);
	if (!template) throw new Error(`failed to save template: ${name}`);
	return template;
}

/** Delete a template. Throws on an invalid `name`, a "project" scope with no workspace, or if the
 * template doesn't exist. */
export function deleteTemplate(dirs: TemplateDirs, scope: TemplateScope, name: string): void {
	if (!isValidTemplateName(name)) throw new Error(`invalid template name: ${JSON.stringify(name)}`);
	const dir = dirForScope(dirs, scope);
	const filePath = join(dir, `${name}.md`);
	if (!existsSync(filePath)) throw new Error(`template not found: ${name} (scope: ${scope})`);
	rmSync(filePath);
}
