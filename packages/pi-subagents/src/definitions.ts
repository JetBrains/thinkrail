// Agent definitions — community-compatible `.md` files with frontmatter, plus the bundled TS-constant
// builtins. Discovery is per invocation (definitions are editable mid-session) with first-name-wins
// precedence: builtins → personal (`<agentDir>/agents/*.md`) → project (`<cwd>/.pi/agents/*.md` +
// `<cwd>/.agents/agents/*.md`). The order IS the trust posture (task-spec decision 6): a worktree
// definition can never shadow a built-in or personal name, and project definitions load at all only
// when the project is trusted (the caller passes `includeProject` from `ctx.isProjectTrusted()`).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { BUILTIN_AGENTS } from "./builtins";

export interface AgentDefinition {
	name: string;
	description: string;
	/** Where the definition came from — flows into `ChildInfo.roleSource` (open vocabulary). */
	source: "builtin" | "personal" | "project";
	filePath?: string;
	/** pi allowlist; absent = pi's default builtin tools. */
	tools?: string[];
	/** Fuzzy model ref (`provider/id`, exact id, or id prefix) — resolved by the mapping layer. */
	model?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	/** Opt-in: worktree AGENTS.md context files (`inherit_project_context: true`). */
	inheritProjectContext?: boolean;
	/** Opt-in: explicit skill names. */
	skills?: string[];
	/** The definition body — becomes the child's system prompt base. */
	systemPrompt: string;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** `a, b` or `[a, b]` → trimmed non-empty names. */
function parseNameList(value: string): string[] {
	return value
		.replace(/^\[|\]$/g, "")
		.split(",")
		.map((name) => name.trim().replace(/^["']|["']$/g, ""))
		.filter((name) => name.length > 0);
}

/**
 * Parse one community-convention definition file: `---` frontmatter (flat `key: value` scalars,
 * comma/inline lists) + body = system prompt. Returns undefined when `name`, `description`, or the
 * body is missing — a malformed file is skipped, never fatal.
 */
export function parseAgentDefinition(
	markdown: string,
	source: AgentDefinition["source"],
	filePath?: string,
): AgentDefinition | undefined {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return undefined;
	const [, frontmatter = "", body = ""] = match;
	const fields = new Map<string, string>();
	for (const line of frontmatter.split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (key && value) fields.set(key, value);
	}
	const name = fields.get("name");
	const description = fields.get("description");
	const systemPrompt = body.trim();
	if (!name || !description || !systemPrompt) return undefined;

	const thinking = fields.get("thinking");
	const maxTurns = Number.parseInt(fields.get("max_turns") ?? "", 10);
	const tools = fields.get("tools");
	const skills = fields.get("skills");
	const model = fields.get("model");
	return {
		name,
		description,
		source,
		...(filePath !== undefined ? { filePath } : {}),
		...(tools !== undefined ? { tools: parseNameList(tools) } : {}),
		...(model !== undefined ? { model } : {}),
		...(thinking !== undefined && THINKING_LEVELS.has(thinking)
			? { thinking: thinking as ThinkingLevel }
			: {}),
		...(Number.isFinite(maxTurns) && maxTurns > 0 ? { maxTurns } : {}),
		...(fields.get("inherit_project_context") === "true" ? { inheritProjectContext: true } : {}),
		...(skills !== undefined ? { skills: parseNameList(skills) } : {}),
		systemPrompt,
	};
}

function readDefinitionDir(dir: string, source: AgentDefinition["source"]): AgentDefinition[] {
	let files: string[];
	try {
		files = readdirSync(dir);
	} catch {
		return [];
	}
	const definitions: AgentDefinition[] = [];
	for (const file of files.filter((name) => name.endsWith(".md")).sort()) {
		const filePath = join(dir, file);
		try {
			const parsed = parseAgentDefinition(readFileSync(filePath, "utf8"), source, filePath);
			if (parsed) definitions.push(parsed);
		} catch {
			// Unreadable file — skip, never fatal.
		}
	}
	return definitions;
}

export interface DiscoverOptions {
	/** The session's worktree — project definition roots hang off it. */
	cwd: string;
	/** pi's agent dir (`getAgentDir()`) — personal definitions live in `<agentDir>/agents/`. */
	agentDir: string;
	/** Project-definition gate — pass `ctx.isProjectTrusted()`; untrusted worktrees load none. */
	includeProject: boolean;
}

/** All definitions visible to a session, first-name-wins in trust order (see module header). */
export function discoverAgentDefinitions(options: DiscoverOptions): AgentDefinition[] {
	const layers: AgentDefinition[][] = [
		[...BUILTIN_AGENTS],
		readDefinitionDir(join(options.agentDir, "agents"), "personal"),
		...(options.includeProject
			? [
					readDefinitionDir(join(options.cwd, CONFIG_DIR_NAME, "agents"), "project"),
					readDefinitionDir(join(options.cwd, ".agents", "agents"), "project"),
				]
			: []),
	];
	const byName = new Map<string, AgentDefinition>();
	for (const layer of layers) {
		for (const definition of layer) {
			if (!byName.has(definition.name)) byName.set(definition.name, definition);
		}
	}
	return [...byName.values()];
}
