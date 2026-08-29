import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionOptions } from "pi-delegation";
import type { AgentDefinition } from "./definitions";

export const RECURSION_GUARD_TOOLS = ["Agent", "get_subagent_result"] as const;

export function resolveModelRef(
	ref: string,
	available: readonly Pick<Model<string>, "provider" | "id">[],
): { provider: string; id: string } | undefined {
	const slash = ref.indexOf("/");
	if (slash > 0) {
		const provider = ref.slice(0, slash);
		const id = ref.slice(slash + 1);
		const exact = available.find((model) => model.provider === provider && model.id === id);
		return exact ? { provider: exact.provider, id: exact.id } : undefined;
	}
	const byId = available.filter((model) => model.id === ref);
	if (byId.length === 1 && byId[0]) return { provider: byId[0].provider, id: byId[0].id };
	if (byId.length > 1) return undefined;
	const byPrefix = available.filter((model) => model.id.startsWith(ref));
	const first = byPrefix[0];
	if (
		first &&
		byPrefix.every((model) => model.id === first.id && model.provider === first.provider)
	) {
		return { provider: first.provider, id: first.id };
	}
	return undefined;
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

export interface SpawnMapping {
	session: SessionOptions;
	maxTurns?: number;
}

export function toSpawnMapping(
	definition: AgentDefinition,
	options: { cwd: string; availableModels: readonly Pick<Model<string>, "provider" | "id">[] },
): SpawnMapping {
	let model: { provider: string; id: string } | undefined;
	if (definition.model !== undefined) {
		model = resolveModelRef(definition.model, options.availableModels);
		if (!model) {
			throw new Error(
				`Agent "${definition.name}" pins model "${definition.model}", which does not match exactly one available model — qualify it as "provider/id"`,
			);
		}
	}
	return {
		session: {
			systemPrompt: buildChildSystemPrompt(definition, options.cwd),
			...(model !== undefined ? { model } : {}),
			...(definition.thinking !== undefined ? { thinkingLevel: definition.thinking } : {}),
			...(definition.tools !== undefined ? { tools: definition.tools } : {}),
			excludeTools: [...RECURSION_GUARD_TOOLS],
			...(definition.inheritProjectContext === true ? { contextFiles: true } : {}),
			...(definition.skills !== undefined ? { skills: definition.skills } : {}),
			...(definition.extensions === true ? { extensions: true } : {}),
		},
		...(definition.maxTurns !== undefined ? { maxTurns: definition.maxTurns } : {}),
	};
}
