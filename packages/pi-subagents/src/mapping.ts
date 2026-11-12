import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionOptions } from "pi-delegation";
import type { AgentDefinition } from "./definitions";
import { isThinkingLevel, THINKING_LEVELS } from "./thinking";

export const RECURSION_GUARD_TOOLS = ["Agent", "get_subagent_result"] as const;

const PARENT_MODEL_ALIASES = new Set(["inherit", "parent", "default"]);
const LISTED_MODELS_LIMIT = 20;

type ModelRef = Pick<Model<string>, "provider" | "id">;
type ModelMatch = { model: ModelRef } | { reason: "missing" | "ambiguous" };

function matchModelRef(ref: string, available: readonly ModelRef[]): ModelMatch {
	const slash = ref.indexOf("/");
	if (slash > 0) {
		const provider = ref.slice(0, slash);
		const id = ref.slice(slash + 1);
		const exact = available.find((model) => model.provider === provider && model.id === id);
		return exact ? { model: { provider: exact.provider, id: exact.id } } : { reason: "missing" };
	}
	const byId = available.filter((model) => model.id === ref);
	if (byId.length === 1 && byId[0])
		return { model: { provider: byId[0].provider, id: byId[0].id } };
	if (byId.length > 1) return { reason: "ambiguous" };
	const byPrefix = available.filter((model) => model.id.startsWith(ref));
	const first = byPrefix[0];
	if (
		first &&
		byPrefix.every((model) => model.id === first.id && model.provider === first.provider)
	) {
		return { model: { provider: first.provider, id: first.id } };
	}
	return { reason: first ? "ambiguous" : "missing" };
}

export function resolveModelRef(ref: string, available: readonly ModelRef[]): ModelRef | undefined {
	const match = matchModelRef(ref, available);
	return "model" in match ? match.model : undefined;
}

const BRIDGE = `## Subagent protocol

You are a subagent: you run non-interactively on one delegated task. Nobody answers questions —
never ask; decide and note assumptions instead. Your final message is your entire report to the
delegating agent: make it self-contained, concrete, and free of filler.`;

function gitBranch(cwd: string): string | undefined {
	try {
		for (let dir = resolve(cwd); ; dir = dirname(dir)) {
			const dotGit = join(dir, ".git");
			const stat = statSync(dotGit, { throwIfNoEntry: false });
			if (stat) {
				const gitDir = stat.isDirectory()
					? dotGit
					: readFileSync(dotGit, "utf8")
							.match(/^gitdir: *(.+)$/m)?.[1]
							?.trim();
				if (!gitDir) return undefined;
				const head = readFileSync(
					join(isAbsolute(gitDir) ? gitDir : join(dir, gitDir), "HEAD"),
					"utf8",
				);
				return head.match(/^ref: refs\/heads\/(.+)$/m)?.[1]?.trim();
			}
			if (dirname(dir) === dir) return undefined;
		}
	} catch {
		return undefined;
	}
}

export function buildChildSystemPrompt(definition: AgentDefinition, cwd: string): string {
	const branch = gitBranch(cwd);
	const env = [
		"## Environment",
		`- Working directory: ${cwd}`,
		...(branch !== undefined ? [`- Git branch: ${branch}`] : []),
		`- Platform: ${process.platform}`,
	].join("\n");
	return `${definition.systemPrompt.trim()}\n\n${BRIDGE}\n\n${env}`;
}

function availableModelsHint(available: readonly ModelRef[]): string {
	if (available.length === 0) return " No models are available in this session.";
	const listed = available
		.slice(0, LISTED_MODELS_LIMIT)
		.map((model) => `${model.provider}/${model.id}`)
		.join(", ");
	const more =
		available.length > LISTED_MODELS_LIMIT
			? ` (+${available.length - LISTED_MODELS_LIMIT} more)`
			: "";
	return ` Available models: ${listed}${more}.`;
}

export interface SpawnMapping {
	session: SessionOptions;
	maxTurns?: number;
}

export function toSpawnMapping(
	definition: AgentDefinition,
	options: {
		cwd: string;
		availableModels: readonly Pick<Model<string>, "provider" | "id">[];
		model?: string;
	},
): SpawnMapping {
	let model: { provider: string; id: string } | undefined;
	let thinkingLevel = definition.thinking;
	const invocationRef =
		options.model !== undefined && PARENT_MODEL_ALIASES.has(options.model.toLowerCase())
			? undefined
			: options.model;
	const modelRef = definition.model ?? invocationRef;
	if (modelRef !== undefined) {
		let lookupRef = modelRef;
		let match = matchModelRef(lookupRef, options.availableModels);
		const colon = modelRef.lastIndexOf(":");
		const suffix = modelRef.slice(colon + 1);
		if ("reason" in match && match.reason === "missing" && colon > 0 && isThinkingLevel(suffix)) {
			lookupRef = modelRef.slice(0, colon);
			match = matchModelRef(lookupRef, options.availableModels);
			thinkingLevel ??= suffix;
		}
		if ("reason" in match) {
			const selection = definition.model !== undefined ? "pins" : "requests";
			const reason =
				match.reason === "ambiguous"
					? 'is ambiguous — qualify it as "provider/id"'
					: "is not available in this session";
			const base = lookupRef === modelRef ? "" : ` (base "${lookupRef}")`;
			const hint =
				match.reason === "missing" && colon >= 0 && !isThinkingLevel(suffix)
					? `; supported thinking suffixes: ${THINKING_LEVELS.join(", ")}`
					: "";
			const omit = selection === "requests" ? " Leave model out to use the parent's model." : "";
			const guidance =
				match.reason === "missing" ? `.${availableModelsHint(options.availableModels)}${omit}` : "";
			throw new Error(
				`Agent "${definition.name}" ${selection} model "${modelRef}"${base}, which ${reason}${hint}${guidance}`,
			);
		}
		model = match.model;
	}
	return {
		session: {
			systemPrompt: buildChildSystemPrompt(definition, options.cwd),
			...(model !== undefined ? { model } : {}),
			...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
			...(definition.tools !== undefined ? { tools: definition.tools } : {}),
			excludeTools: [...RECURSION_GUARD_TOOLS],
			...(definition.inheritProjectContext === true ? { contextFiles: true } : {}),
			...(definition.skills !== undefined ? { skills: definition.skills } : {}),
			...(definition.extensions === true ? { extensions: true } : {}),
		},
		...(definition.maxTurns !== undefined ? { maxTurns: definition.maxTurns } : {}),
	};
}
