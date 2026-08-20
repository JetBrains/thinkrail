import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	rmSync,
	type Stats,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { Template, TemplateInfo, TemplateScope } from "@thinkrail/contracts";

export interface TemplateDirs {
	globalDir: string;
	projectDir?: string;
}

export function isValidTemplateName(name: string): boolean {
	if (name.length === 0) return false;
	if (name.startsWith(".")) return false;
	return !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

export function templateDirs(cwd?: string, agentDir: string = getAgentDir()): TemplateDirs {
	return {
		globalDir: join(agentDir, "prompts"),
		...(cwd ? { projectDir: join(cwd, CONFIG_DIR_NAME, "prompts") } : {}),
	};
}

function dirForScope(dirs: TemplateDirs, scope: TemplateScope): string {
	if (scope === "project") {
		if (!dirs.projectDir)
			throw new Error('template scope "project" requires a workspace (projectDir)');
		return dirs.projectDir;
	}
	return dirs.globalDir;
}

function lstatOrNull(path: string): Stats | null {
	try {
		return lstatSync(path);
	} catch {
		return null;
	}
}

function isRegularFile(path: string): boolean {
	return lstatOrNull(path)?.isFile() ?? false;
}

function projectDirTraversable(projectDir: string): boolean {
	return ![dirname(projectDir), projectDir].some(
		(dir) => lstatOrNull(dir)?.isSymbolicLink() ?? false,
	);
}

function assertProjectWriteSafe(dirs: TemplateDirs, scope: TemplateScope): void {
	if (scope !== "project" || !dirs.projectDir) return;
	if (!projectDirTraversable(dirs.projectDir)) {
		throw new Error(
			`refusing to write templates through a symlinked directory: ${dirs.projectDir}`,
		);
	}
}

function readableProjectDir(dirs: TemplateDirs): string | undefined {
	return dirs.projectDir && projectDirTraversable(dirs.projectDir) ? dirs.projectDir : undefined;
}

export const MAX_TEMPLATE_BYTES = 1024 * 1024;

const FRONTMATTER_SCAN_BYTES = 8 * 1024;

function readHead(filePath: string, bytes: number): string {
	const fd = openSync(filePath, "r");
	try {
		const buffer = Buffer.alloc(bytes);
		const bytesRead = readSync(fd, buffer, 0, bytes, 0);
		return buffer.toString("utf-8", 0, bytesRead);
	} finally {
		closeSync(fd);
	}
}

function frontmatterMeta(text: string): Pick<TemplateInfo, "description" | "argumentHint"> {
	const { frontmatter } = parseFrontmatter(text);
	const description =
		typeof frontmatter.description === "string" ? frontmatter.description : undefined;
	const argumentHint =
		typeof frontmatter["argument-hint"] === "string" ? frontmatter["argument-hint"] : undefined;
	return {
		...(description ? { description } : {}),
		...(argumentHint ? { argumentHint } : {}),
	};
}

function readTemplateMeta(dir: string, scope: TemplateScope, name: string): TemplateInfo | null {
	const filePath = join(dir, `${name}.md`);
	const stats = lstatOrNull(filePath);
	if (!stats?.isFile() || stats.size > MAX_TEMPLATE_BYTES) return null;
	const head = readHead(filePath, FRONTMATTER_SCAN_BYTES);
	return { name, ...frontmatterMeta(head), scope, filePath };
}

function readTemplateFile(dir: string, scope: TemplateScope, name: string): Template | null {
	const filePath = join(dir, `${name}.md`);
	const stats = lstatOrNull(filePath);
	if (!stats?.isFile()) return null;
	if (stats.size > MAX_TEMPLATE_BYTES) {
		throw new Error(
			`template file too large: ${name}.md (${stats.size} bytes, limit ${MAX_TEMPLATE_BYTES})`,
		);
	}
	const content = readFileSync(filePath, "utf-8");
	return { name, ...frontmatterMeta(content), content, scope, filePath };
}

function listDir(dir: string | undefined, scope: TemplateScope): TemplateInfo[] {
	if (!dir || !existsSync(dir)) return [];
	const templates: TemplateInfo[] = [];
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const name = entry.name.replace(/\.md$/, "");
			if (!isValidTemplateName(name)) continue;
			try {
				const template = readTemplateMeta(dir, scope, name);
				if (template) templates.push(template);
			} catch {}
		}
	} catch {}
	return templates;
}

export function listTemplates(dirs: TemplateDirs): TemplateInfo[] {
	const byName = new Map<string, TemplateInfo>();
	for (const template of listDir(dirs.globalDir, "global")) byName.set(template.name, template);
	for (const template of listDir(readableProjectDir(dirs), "project"))
		byName.set(template.name, template);
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getTemplate(dirs: TemplateDirs, name: string, scope?: TemplateScope): Template {
	if (!isValidTemplateName(name)) throw new Error(`invalid template name: ${JSON.stringify(name)}`);
	if (scope) {
		const scopeDir = dirForScope(dirs, scope);
		const dir = scope === "project" ? readableProjectDir(dirs) : scopeDir;
		const template = dir ? readTemplateFile(dir, scope, name) : null;
		if (!template) throw new Error(`template not found: ${name} (scope: ${scope})`);
		return template;
	}
	const projectDir = readableProjectDir(dirs);
	if (projectDir) {
		const projectTemplate = readTemplateFile(projectDir, "project", name);
		if (projectTemplate) return projectTemplate;
	}
	const globalTemplate = readTemplateFile(dirs.globalDir, "global", name);
	if (globalTemplate) return globalTemplate;
	throw new Error(`template not found: ${name}`);
}

export function saveTemplate(
	dirs: TemplateDirs,
	scope: TemplateScope,
	name: string,
	content: string,
): Template {
	if (!isValidTemplateName(name)) throw new Error(`invalid template name: ${JSON.stringify(name)}`);
	const size = Buffer.byteLength(content, "utf-8");
	if (size > MAX_TEMPLATE_BYTES) {
		throw new Error(`template too large: ${size} bytes (limit ${MAX_TEMPLATE_BYTES})`);
	}
	try {
		parseFrontmatter(content);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`invalid frontmatter: ${message}`);
	}
	const dir = dirForScope(dirs, scope);
	assertProjectWriteSafe(dirs, scope);
	const filePath = join(dir, `${name}.md`);
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

export function deleteTemplate(dirs: TemplateDirs, scope: TemplateScope, name: string): void {
	if (!isValidTemplateName(name)) throw new Error(`invalid template name: ${JSON.stringify(name)}`);
	const dir = dirForScope(dirs, scope);
	assertProjectWriteSafe(dirs, scope);
	const filePath = join(dir, `${name}.md`);
	if (!isRegularFile(filePath)) throw new Error(`template not found: ${name} (scope: ${scope})`);
	rmSync(filePath);
}
