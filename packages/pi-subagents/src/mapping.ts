// The definition → spawn mapping (policy, not mechanism): an AgentDefinition becomes the core's
// SessionOptions + RunOptions.maxTurns. Owns fuzzy model resolution against the session's available
// models, the assembled child system prompt (stable material first, for KV-cache prefix reuse:
// definition body → subagent bridge → env block), and the recursion guard.

import { execFileSync } from "node:child_process";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionOptions } from "pi-delegation";
import type { AgentDefinition } from "./definitions";

/** The recursion guard — children never see the delegation tools (denylist survives registry rebuilds). */
export const RECURSION_GUARD_TOOLS = ["Agent", "get_subagent_result"] as const;

/**
 * Fuzzy-resolve a definition's model ref against the available models: exact `provider/id` →
 * exact id → unique id prefix. Undefined when nothing (or nothing unambiguous) matches.
 */
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
	if (byId.length >= 1 && byId[0]) return { provider: byId[0].provider, id: byId[0].id };
	const byPrefix = available.filter((model) => model.id.startsWith(ref));
	const first = byPrefix[0];
	if (first && byPrefix.every((model) => model.id === first.id)) {
		return { provider: first.provider, id: first.id };
	}
	return undefined;
}

/** The subagent guidance bridge — stable text between the definition body and the env block. */
const BRIDGE = `## Subagent protocol

You are a subagent: you run non-interactively on one delegated task. Nobody answers questions —
never ask; decide and note assumptions instead. Your final message is your entire report to the
delegating agent: make it self-contained, concrete, and free of filler.`;

function gitBranch(cwd: string): string | undefined {
	try {
		const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 2000,
		})
			.toString()
			.trim();
		return branch.length > 0 ? branch : undefined;
	} catch {
		return undefined;
	}
}

/** Body → bridge → env: the stable material leads so sibling spawns share a KV-cache prefix. */
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

/**
 * Map a definition onto the core's mirror options. Model/thinking fall through to the parent's
 * current values when the definition doesn't pin them; an unresolvable pinned model throws (loud,
 * caught by the tool and surfaced to the model as the tool error).
 */
export function toSpawnMapping(
	definition: AgentDefinition,
	options: { cwd: string; availableModels: readonly Pick<Model<string>, "provider" | "id">[] },
): SpawnMapping {
	let model: { provider: string; id: string } | undefined;
	if (definition.model !== undefined) {
		model = resolveModelRef(definition.model, options.availableModels);
		if (!model) {
			throw new Error(
				`Agent "${definition.name}" pins model "${definition.model}", which matches none of the available models`,
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
		},
		...(definition.maxTurns !== undefined ? { maxTurns: definition.maxTurns } : {}),
	};
}
