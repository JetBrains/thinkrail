import { inferredMime } from "./describe";
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
