import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { MODULE_SECTIONS, SpecIndex, type SpecType } from "../core/index.ts";

const indexes = new Map<string, SpecIndex>();

export function getIndex(root: string): SpecIndex {
	let index = indexes.get(root);
	if (!index) {
		index = new SpecIndex(root);
		indexes.set(root, index);
	}
	return index;
}

export function textResult<T>(text: string, details: T): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details };
}

export function errorResult(message: string): AgentToolResult<{ error: string }> {
	return { content: [{ type: "text", text: `Error: ${message}` }], details: { error: message } };
}

const SCAFFOLD_HEADINGS: Record<SpecType, readonly string[]> = {
	"module-design": MODULE_SECTIONS,
	"submodule-design": MODULE_SECTIONS,
	"architecture-design": ["Drivers", "Decisions", "Invariants", "Out of scope"],
	"goal-and-requirements": ["Goal", "Scope"],
	"task-spec": ["Purpose", "Open items"],
};

export function scaffoldBody(type: SpecType): string {
	const headings = SCAFFOLD_HEADINGS[type];
	if (!headings || headings.length === 0) return "";
	return `${headings.map((h) => `## ${h}\n`).join("\n")}`;
}

export const MODULE_SCAFFOLD_GUIDE = [
	"Responsibility: one paragraph — what it is for, what it owns.",
	"Boundary: public surface / allowed deps / forbidden reaches, as short lists.",
	"Behavior: one ### per topic (≤ ~20 lines each) — what the caller or user observes.",
	'Invariants: numbered one-liners that must hold ("never", "always", "exactly one").',
	"Decisions: one ### per decision (YYYY-MM): context → choice → rejected alternatives.",
	"History: post-mortems, one line each: YYYY-MM · symptom · cause → Invariant #n.",
	"Delete any section you leave empty; spec_validate reports empty and off-skeleton sections.",
].join("\n");
