import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentResult, AgentSpec } from "@thinkrail/ext";
import { addUsage, emptyUsage, type Usage } from "./model";
import type { AgentOptions, JsonSchema } from "./types";
import { assertSchemaSupported, validate } from "./validate";

export type ChildSpec = Omit<AgentSpec, "task">;

export interface ChildPatch {
	childId?: string;
	state?: "running";
	model?: string;
	usage?: Usage;
	activity?: string;
}

export interface ChildRequest {
	task: string;
	spec: ChildSpec;
	signal: AbortSignal;
	onPatch: (patch: ChildPatch) => void;
}

export type RunChild = (request: ChildRequest) => Promise<AgentResult>;

export interface ModelRef {
	provider: string;
	id: string;
	name?: string;
}

export interface AgentContext {
	cwd: string;
	models: () => readonly ModelRef[];
	runChild: RunChild;
}

export interface AgentProgress extends ChildPatch {
	attempt: number;
}

export interface AgentRunResult {
	text: string;
	value: unknown;
	usage: Usage;
	attempts: number;
	model?: string;
}

export const normalizeTools = (tools: AgentOptions["tools"]) => {
	if (tools === undefined || tools === null || tools === true) return undefined;
	if (tools === false) return [];
	if (typeof tools === "string")
		return tools
			.split(",")
			.map((tool) => tool.trim())
			.filter(Boolean);
	if (Array.isArray(tools))
		return tools
			.map(String)
			.map((tool) => tool.trim())
			.filter(Boolean);
	return undefined;
};

const isDirectory = (dir: string) => {
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
};

const findProjectAgentsDir = (cwd: string) => {
	let dir = path.resolve(cwd);
	for (;;) {
		const candidate = path.join(dir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
};

const loadNamedAgent = (cwd: string, name: string) => {
	if (!/^[\w.-]+$/.test(name) || name.startsWith("."))
		throw new Error(`agentType "${name}" is not a valid agent name`);
	const projectDir =
		findProjectAgentsDir(cwd) ?? path.join(path.resolve(cwd), CONFIG_DIR_NAME, "agents");
	const searched = [
		path.join(projectDir, `${name}.md`),
		path.join(getAgentDir(), "agents", `${name}.md`),
	];
	for (const file of searched) {
		if (!fs.existsSync(file)) continue;
		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(
			fs.readFileSync(file, "utf8"),
		);
		const tools = normalizeTools(frontmatter.tools as AgentOptions["tools"]);
		const model = frontmatter.model;
		return {
			systemPrompt: body.trim(),
			...(tools !== undefined ? { tools } : {}),
			...(typeof model === "string" && model ? { model } : {}),
		};
	}
	throw new Error(`agentType "${name}" not found; searched: ${searched.join(", ")}`);
};

const describe = (model: ModelRef) => `${model.provider}/${model.id}`;

const listModels = (models: readonly ModelRef[]) => {
	const shown = models.slice(0, 8).map(describe).join(", ");
	return models.length > 8 ? `${shown}, … (${models.length} total)` : shown;
};

export const matchModel = (pattern: string, models: readonly ModelRef[]) => {
	const needle = pattern.trim().toLowerCase();
	if (!needle) throw new Error("model pattern is empty");
	const pick = (found: readonly ModelRef[]) => {
		const [only] = found;
		if (only && found.length === 1) return { provider: only.provider, id: only.id };
		if (found.length > 1)
			throw new Error(
				`model "${pattern}" is ambiguous: it matches ${found.length} models (${listModels(found)}). Pass the exact provider/id.`,
			);
		return undefined;
	};
	return (
		pick(models.filter((model) => describe(model).toLowerCase() === needle)) ??
		pick(models.filter((model) => model.id.toLowerCase() === needle)) ??
		pick(
			models.filter(
				(model) =>
					describe(model).toLowerCase().includes(needle) ||
					(model.name ?? "").toLowerCase().includes(needle),
			),
		) ??
		(() => {
			throw new Error(
				`model "${pattern}" matched nothing. Known models include: ${listModels(models)}`,
			);
		})()
	);
};

const buildSpec = (options: AgentOptions, context: AgentContext): ChildSpec => {
	const named = options.agentType ? loadNamedAgent(context.cwd, options.agentType) : undefined;
	const system = [named?.systemPrompt, options.system]
		.filter((part): part is string => typeof part === "string" && part.trim().length > 0)
		.join("\n\n");
	const pattern = options.model ?? named?.model;
	const tools = normalizeTools(options.tools) ?? named?.tools;
	return {
		...(options.label !== undefined ? { role: options.label } : {}),
		...(system ? { systemPrompt: system } : {}),
		...(tools !== undefined ? { tools } : {}),
		...(pattern !== undefined ? { model: matchModel(pattern, context.models()) } : {}),
		...(options.effort !== undefined ? { thinkingLevel: options.effort } : {}),
		...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
	};
};

const schemaInstruction = (schema: JsonSchema) =>
	[
		"\n\n---",
		"Respond with ONLY a single JSON value matching this JSON Schema.",
		"No prose, no explanation, no markdown code fences.",
		`JSON Schema:\n${JSON.stringify(schema)}`,
	].join("\n");

export const extractJson = (text: string): unknown => {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced?.[1] ?? text;
	const objectStart = candidate.indexOf("{");
	const arrayStart = candidate.indexOf("[");
	const begin =
		objectStart === -1
			? arrayStart
			: arrayStart === -1
				? objectStart
				: Math.min(objectStart, arrayStart);
	if (begin === -1) throw new Error("no JSON object found in output");
	const end = candidate.lastIndexOf(candidate[begin] === "{" ? "}" : "]");
	if (end < begin) throw new Error("unterminated JSON in output");
	return JSON.parse(candidate.slice(begin, end + 1));
};

const parseAnswer = (text: string, schema: JsonSchema) => {
	try {
		const value = extractJson(text);
		const checked = validate(value, schema);
		if (checked.ok) return { ok: true as const, value };
		return {
			ok: false as const,
			error: `schema validation failed: ${checked.errors.slice(0, 8).join("; ")}`,
		};
	} catch (error) {
		return { ok: false as const, error: `JSON parse failed: ${(error as Error).message}` };
	}
};

export const runAgent = async ({
	prompt,
	options,
	context,
	signal,
	onProgress,
}: {
	prompt: string;
	options: AgentOptions;
	context: AgentContext;
	signal: AbortSignal;
	onProgress: (progress: AgentProgress) => void;
}): Promise<AgentRunResult> => {
	if (!prompt.trim()) throw new Error("agent() requires a non-empty prompt");
	if (options.schema) assertSchemaSupported(options.schema);
	const spec = buildSpec(options, context);
	const basePrompt = options.schema ? `${prompt}${schemaInstruction(options.schema)}` : prompt;
	let billed = emptyUsage();
	let attempts = 0;

	const attempt = async (task: string) => {
		attempts += 1;
		const prior = billed;
		const result = await context.runChild({
			task,
			spec,
			signal,
			onPatch: (patch) =>
				onProgress({
					...patch,
					attempt: attempts,
					...(patch.usage ? { usage: addUsage(prior, patch.usage) } : {}),
				}),
		});
		billed = addUsage(prior, result.usage);
		onProgress({ attempt: attempts, usage: billed });
		if (result.status === "aborted") throw new Error("agent was cancelled");
		if (result.status === "error")
			throw new Error(`agent failed: ${result.errorMessage ?? "model error"}`);
		return result;
	};

	const finish = (text: string, value: unknown, model: string | undefined) => ({
		text,
		value,
		usage: billed,
		attempts,
		...(model !== undefined ? { model } : {}),
	});

	const first = await attempt(basePrompt);
	const text = first.finalText ?? "";
	if (!options.schema) {
		if (!text.trim()) throw new Error("agent failed: child produced no output");
		return finish(text, text, first.model);
	}
	const parsed = parseAnswer(text, options.schema);
	if (parsed.ok) return finish(text, parsed.value, first.model);
	const retry = await attempt(
		`${basePrompt}\n\n---\nYour previous reply could not be used (${parsed.error}). Reply again with ONLY valid JSON matching the schema.`,
	);
	const retryText = retry.finalText ?? "";
	const reparsed = parseAnswer(retryText, options.schema);
	if (!reparsed.ok) throw new Error(`agent failed: ${reparsed.error}`);
	return finish(retryText, reparsed.value, retry.model);
};
