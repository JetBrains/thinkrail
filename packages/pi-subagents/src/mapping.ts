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
type ModelMatch =
	| { model: ModelRef }
	| { reason: "missing" }
	| { reason: "ambiguous"; candidates: ModelRef[] };

const NUMBER_TOKEN = /^\d+$/;
const DATE_TOKEN = /^\d{8}$/;

function tokens(text: string): string[] {
	return text.toLowerCase().match(/[a-z]+|[0-9]+/g) ?? [];
}

function wordMatch(refTokens: readonly string[], id: string): boolean {
	const idTokens = tokens(id);
	const last = refTokens.length - 1;
	for (let start = 0; start + last < idTokens.length; start++) {
		if (
			refTokens.every((token, i) =>
				i === last ? idTokens[start + i]?.startsWith(token) : idTokens[start + i] === token,
			)
		)
			return true;
	}
	return false;
}

function family(id: string): string {
	return tokens(id)
		.filter((token) => !NUMBER_TOKEN.test(token))
		.join("-");
}

function compareNewest(a: string, b: string): number {
	const numbers = (id: string) => tokens(id).filter((token) => NUMBER_TOKEN.test(token));
	const version = (id: string) =>
		numbers(id)
			.filter((token) => !DATE_TOKEN.test(token))
			.map(Number);
	const date = (id: string) => Number(numbers(id).find((token) => DATE_TOKEN.test(token)) ?? 0);
	const [va, vb] = [version(a), version(b)];
	for (let i = 0; i < Math.max(va.length, vb.length); i++) {
		const diff = (vb[i] ?? 0) - (va[i] ?? 0);
		if (diff !== 0) return diff;
	}
	const [da, db] = [date(a), date(b)];
	if ((da === 0) !== (db === 0)) return da === 0 ? -1 : 1;
	return db - da;
}

function pickCandidate(candidates: readonly ModelRef[]): ModelMatch {
	const groups = new Map<string, ModelRef[]>();
	for (const { provider, id } of candidates) {
		const key = `${provider}\u0000${family(id)}`;
		const group = groups.get(key) ?? [];
		if (!group.some((model) => model.id === id)) group.push({ provider, id });
		groups.set(key, group);
	}
	const survivors = [...groups.values()].flatMap((group) => {
		const newest = group.reduce((best, model) =>
			compareNewest(model.id, best.id) < 0 ? model : best,
		);
		return group.filter((model) => compareNewest(model.id, newest.id) === 0);
	});
	const [only] = survivors;
	return survivors.length === 1 && only
		? { model: only }
		: { reason: "ambiguous", candidates: survivors };
}

function matchModelRef(ref: string, available: readonly ModelRef[]): ModelMatch {
	let pool = available;
	let text = ref;
	const slash = ref.indexOf("/");
	if (slash > 0) {
		const qualifier = ref.slice(0, slash).toLowerCase();
		const scoped = available.filter((model) => model.provider.toLowerCase() === qualifier);
		if (scoped.length > 0) {
			pool = scoped;
			text = ref.slice(slash + 1);
		}
	}
	if (text === "") return { reason: "missing" };
	const refTokens = text.includes(":") ? [] : tokens(text);
	const tiers: ((model: ModelRef) => boolean)[] = [
		(model) => model.id === text,
		(model) => model.id.startsWith(text),
		(model) => refTokens.length > 0 && wordMatch(refTokens, model.id),
	];
	for (const matches of tiers) {
		const candidates = pool.filter(matches);
		if (candidates.length > 0) return pickCandidate(candidates);
	}
	return { reason: "missing" };
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

function listRefs(models: readonly ModelRef[]): string {
	const listed = models
		.slice(0, LISTED_MODELS_LIMIT)
		.map((model) => `${model.provider}/${model.id}`)
		.join(", ");
	const more =
		models.length > LISTED_MODELS_LIMIT ? ` (+${models.length - LISTED_MODELS_LIMIT} more)` : "";
	return `${listed}${more}`;
}

function availableModelsHint(available: readonly ModelRef[]): string {
	if (available.length === 0) return " No models are available in this session.";
	return ` Available models: ${listRefs(available)}.`;
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
		options.model === undefined ||
		options.model.trim() === "" ||
		PARENT_MODEL_ALIASES.has(options.model.toLowerCase())
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
					? `is ambiguous — it matches ${listRefs(match.candidates)}. Retry with one of them as "provider/id"`
					: "is not available in this session";
			const base = lookupRef === modelRef ? "" : ` (base "${lookupRef}")`;
			const hint =
				match.reason === "missing" && colon >= 0 && !isThinkingLevel(suffix)
					? `; supported thinking suffixes: ${THINKING_LEVELS.join(", ")}`
					: "";
			const omit = selection === "requests" ? " Leave model out to use the parent's model." : "";
			const guidance =
				match.reason === "missing"
					? `.${availableModelsHint(options.availableModels)}${omit}`
					: ".";
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
