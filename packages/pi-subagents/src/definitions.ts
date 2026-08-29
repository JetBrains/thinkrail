import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { BUILTIN_AGENTS } from "./builtins";

export interface AgentDefinition {
	name: string;
	description: string;
	source: "builtin" | "personal" | "project";
	filePath?: string;
	tools?: string[];
	model?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	inheritProjectContext?: boolean;
	skills?: string[];
	extensions?: boolean;
	systemPrompt: string;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function unquote(value: string): string {
	const first = value[0];
	return (first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)
		? value.slice(1, -1).trim()
		: value;
}

function parseNameList(value: string): string[] {
	return value
		.replace(/^\[|\]$/g, "")
		.split(",")
		.map((name) => name.trim().replace(/^["']|["']$/g, ""))
		.filter((name) => name.length > 0);
}

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
		const value = unquote(line.slice(separator + 1).trim());
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
		...(fields.get("extensions") === "true" ? { extensions: true } : {}),
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
		} catch {}
	}
	return definitions;
}

export interface DiscoverOptions {
	cwd: string;
	agentDir: string;
	includeProject: boolean;
}

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
