import type { GitDiffScope } from "@thinkrail/contracts";
import { PENDING_TEXT_META } from "./content";
import { describeResource, inferredMime } from "./describe";
import { selectResourceRenderer } from "./selection";
import type {
	ResourceDescriptor,
	ResourceEnvironment,
	ResourceIntent,
	ResourceRenderer,
} from "./types";

const registry = new Map<string, ResourceRenderer>();

function globRegex(pattern: string): RegExp {
	let source = "";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index] ?? "";
		if (char === "*") {
			if (pattern[index + 1] === "*") index += 1;
			source += ".*";
		} else if (char === "?") {
			source += ".";
		} else {
			source += char.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
		}
	}
	return new RegExp(`^${source}$`, "i");
}

function matchesGlob(path: string, pattern: string): boolean {
	const target = pattern.includes("/") ? path : (path.split("/").at(-1) ?? path);
	return globRegex(pattern).test(target);
}

function matchesPattern(value: string | undefined, patterns: readonly string[]): boolean {
	if (value === undefined) return false;
	const lower = value.toLowerCase();
	return patterns.some((pattern) => {
		const normalized = pattern.toLowerCase();
		if (normalized.endsWith("/*")) return lower.startsWith(normalized.slice(0, -1));
		return lower === normalized;
	});
}

function matchesDescriptor(renderer: ResourceRenderer, descriptor: ResourceDescriptor): boolean {
	const match = renderer.match;
	if (match.text !== undefined && match.text !== descriptor.text) return false;
	if (match.glob && !match.glob.some((pattern) => matchesGlob(descriptor.path, pattern)))
		return false;
	if (match.mime && !matchesPattern(descriptor.mime ?? inferredMime(descriptor.path), match.mime))
		return false;
	if (match.language && !matchesPattern(descriptor.language, match.language)) return false;
	return true;
}

function supports(
	renderer: ResourceRenderer,
	intent: ResourceIntent,
	environment: ResourceEnvironment,
): boolean {
	if (!renderer.capabilities[intent]) return false;
	return !environment.mobile || renderer.capabilities.mobile;
}

export function registerResourceRenderer(renderer: ResourceRenderer): () => void {
	const previous = registry.get(renderer.id);
	registry.set(renderer.id, renderer);
	return () => {
		if (registry.get(renderer.id) !== renderer) return;
		if (previous) registry.set(renderer.id, previous);
		else registry.delete(renderer.id);
	};
}

export function resolveRenderers(
	descriptor: ResourceDescriptor,
	intent: ResourceIntent,
	environment: ResourceEnvironment,
): ResourceRenderer[] {
	const fallbackId = descriptor.text ? "thinkrail/code" : "thinkrail/binary";
	const fallback = registry.get(fallbackId);
	if (!fallback || !supports(fallback, intent, environment)) {
		throw new Error(`Resource renderer fallback is unavailable: ${fallbackId} (${intent})`);
	}
	const candidates = [...registry.values()]
		.filter(
			(renderer) =>
				renderer.id !== fallbackId &&
				matchesDescriptor(renderer, descriptor) &&
				supports(renderer, intent, environment),
		)
		.sort((left, right) => right.rank - left.rank);
	return [...candidates, fallback];
}

function inferredBinary(path: string): boolean {
	const mime = inferredMime(path);
	return (
		mime !== undefined &&
		(mime === "application/pdf" || mime.startsWith("image/")) &&
		mime !== "image/svg+xml"
	);
}

// Whether the diff renderer a file would get — resolved from its path alone, before content loads —
// honours the split/unified layout control. The text/binary split is inferred from the path's MIME
// (known image and PDF types resolve to their layout-less renderers; an unknown-extension binary reads
// as text until its bytes load). Lets a pane-level toggle hide itself when no file in a scope can use it.
export function diffRendererSupportsLayout(
	workspaceId: string,
	path: string,
	scope: GitDiffScope,
	selectedId: string | undefined,
	mobile: boolean,
): boolean {
	const meta = inferredBinary(path) ? { ...PENDING_TEXT_META, text: false } : PENDING_TEXT_META;
	const candidates = resolveRenderers(describeResource(workspaceId, path, meta, scope), "diff", {
		mobile,
	});
	return selectResourceRenderer(candidates, selectedId, path).capabilities.layout;
}
