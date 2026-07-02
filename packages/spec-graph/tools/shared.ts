// Shared plumbing for the spec tools: a per-root index cache and result/scaffold helpers. Thin wrappers
// over `core/` — this is the only file in `tools/` that reaches into the filesystem for writes.

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { SpecIndex, type SpecType } from "../core/index.ts";

/** One index per spec root (session cwd). Rebuilt lazily; freshness handled inside {@link SpecIndex}. */
const indexes = new Map<string, SpecIndex>();

/** Get (or create) the index for a spec root. */
export function getIndex(root: string): SpecIndex {
	let index = indexes.get(root);
	if (!index) {
		index = new SpecIndex(root);
		indexes.set(root, index);
	}
	return index;
}

/** Wrap text + structured details into the agent tool-result shape. */
export function textResult<T>(text: string, details: T): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details };
}

/** An error result carrying a message the model can act on. */
export function errorResult(message: string): AgentToolResult<{ error: string }> {
	return { content: [{ type: "text", text: `Error: ${message}` }], details: { error: message } };
}

/** Heading stubs scaffolded into a new spec body, keyed by `type` (exhaustive over {@link SpecType}). */
const SCAFFOLD_HEADINGS: Record<SpecType, string[]> = {
	"module-design": ["Responsibility", "Boundary"],
	"submodule-design": ["Responsibility", "Boundary"],
	"architecture-design": ["Drivers", "Decisions", "Invariants", "Out of scope"],
	"goal-and-requirements": ["Goal", "Scope"],
	"task-spec": ["Purpose", "Open items"],
};

/** The heading-only body stub for a given spec type (empty for an unknown/scaffold-less type). */
export function scaffoldBody(type: SpecType): string {
	const headings = SCAFFOLD_HEADINGS[type];
	if (!headings || headings.length === 0) return "";
	return `${headings.map((h) => `## ${h}\n`).join("\n")}`;
}
