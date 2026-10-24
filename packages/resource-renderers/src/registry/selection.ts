import type { ResourceRenderer } from "./types";

export function selectResourceRenderer(
	candidates: readonly ResourceRenderer[],
	selectedId: string | undefined,
	path: string,
): ResourceRenderer {
	const renderer = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
	if (!renderer) throw new Error(`No resource renderer resolved for ${path}`);
	return renderer;
}

export function rendererImplementationKey(rendererId: string, mobile: boolean): string {
	return `${rendererId}:${mobile ? "phone" : "desktop"}`;
}

export function rendererTestId(rendererId: string): string {
	const suffix = rendererId.startsWith("thinkrail/")
		? rendererId.slice("thinkrail/".length)
		: rendererId.replaceAll("/", "-");
	return `view-toggle-${suffix}`;
}
