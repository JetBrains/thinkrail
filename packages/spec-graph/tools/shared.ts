// Shared plumbing for the spec tools: per-root index/registry caches and result/scaffold helpers. Thin
// wrappers over `core/` — this is the only file in `tools/` that reaches into the filesystem for writes.

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { SpecIndex, type SpecTypeCard, SpecTypeRegistry } from "../core/index.ts";

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

/** One type-card registry per spec root; freshness handled inside {@link SpecTypeRegistry}. */
const registries = new Map<string, SpecTypeRegistry>();

/** Get (or create) the type-card registry for a spec root. */
export function getRegistry(root: string): SpecTypeRegistry {
	let registry = registries.get(root);
	if (!registry) {
		registry = new SpecTypeRegistry(root);
		registries.set(root, registry);
	}
	return registry;
}

/** Wrap text + structured details into the agent tool-result shape. */
export function textResult<T>(text: string, details: T): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details };
}

/** An error result carrying a message the model can act on. */
export function errorResult(message: string): AgentToolResult<{ error: string }> {
	return { content: [{ type: "text", text: `Error: ${message}` }], details: { error: message } };
}

/**
 * The body stub for a new spec, driven by its type card: the card's Template block when present, else
 * heading stubs from the card's expected sections, else empty.
 */
export function scaffoldBody(card: SpecTypeCard): string {
	if (card.template !== undefined) return card.template;
	if (card.sections.length === 0) return "";
	return `${card.sections.map((h) => `## ${h}\n`).join("\n")}`;
}
