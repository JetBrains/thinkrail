import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { SpecIndex, type SpecType } from "../core/index.ts";

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

const SCAFFOLD_HEADINGS: Record<SpecType, string[]> = {
	"module-design": ["Responsibility", "Boundary"],
	"submodule-design": ["Responsibility", "Boundary"],
	"architecture-design": ["Drivers", "Decisions", "Invariants", "Out of scope"],
	"goal-and-requirements": ["Goal", "Scope"],
	"task-spec": ["Purpose", "Open items"],
};

export function scaffoldBody(type: SpecType): string {
	const headings = SCAFFOLD_HEADINGS[type];
	if (!headings || headings.length === 0) return "";
	return `${headings.map((h) => `## ${h}\n`).join("\n")}`;
}
