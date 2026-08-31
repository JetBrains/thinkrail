import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { CONFIG_DIR_NAME, parseFrontmatter } from "@earendil-works/pi-coding-agent";
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized || undefined;
}

function parseNameList(value: unknown): string[] | undefined {
	let values: string[];
	if (typeof value === "string") {
		values = value.split(",");
	} else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		values = value;
	} else {
		return undefined;
	}
	const names = values.map((name) => name.trim());
	return names.length > 0 && names.every((name) => name.length > 0) ? names : undefined;
}

export function parseAgentDefinition(
	markdown: string,
	source: AgentDefinition["source"],
	filePath?: string,
): AgentDefinition | undefined {
	try {
		const { frontmatter: parsedFrontmatter, body } = parseFrontmatter(markdown);
		const frontmatter: unknown = parsedFrontmatter;
		if (!isRecord(frontmatter)) return undefined;

		const name = nonEmptyString(frontmatter.name);
		const description = nonEmptyString(frontmatter.description);
		const systemPrompt = body.trim();
		if (!name || !description || !systemPrompt) return undefined;

		let tools: string[] | undefined;
		if (Object.hasOwn(frontmatter, "tools")) {
			tools = parseNameList(frontmatter.tools);
			if (!tools) return undefined;
		}

		let skills: string[] | undefined;
		if (Object.hasOwn(frontmatter, "skills")) {
			skills = parseNameList(frontmatter.skills);
			if (!skills) return undefined;
		}

		const model = nonEmptyString(frontmatter.model);
		const thinking = frontmatter.thinking;
		const maxTurns = frontmatter.max_turns;
		return {
			name,
			description,
			source,
			...(filePath !== undefined ? { filePath } : {}),
			...(tools !== undefined ? { tools } : {}),
			...(model !== undefined ? { model } : {}),
			...(typeof thinking === "string" && THINKING_LEVELS.has(thinking)
				? { thinking: thinking as ThinkingLevel }
				: {}),
			...(typeof maxTurns === "number" && Number.isInteger(maxTurns) && maxTurns > 0
				? { maxTurns }
				: {}),
			...(frontmatter.inherit_project_context === true ? { inheritProjectContext: true } : {}),
			...(skills !== undefined ? { skills } : {}),
			...(frontmatter.extensions === true ? { extensions: true } : {}),
			systemPrompt,
		};
	} catch {
		return undefined;
	}
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
