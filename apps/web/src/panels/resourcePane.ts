import type { GitDiffScope, ResourceMeta } from "@thinkrail/contracts";
import { useEffect, useRef } from "react";
import { describeResource, type ResourceRenderer, resolveRenderers } from "../resources";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

export const PENDING_TEXT_META: ResourceMeta = { hash: null, byteLength: null, text: true };
export const FILES_ROUTE = "/files";
export const BLOB_ROUTE = "/blob";

function encodeResourcePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

export function resourceBytesUrl(workspaceId: string, path: string, oid?: string | null): string {
	const base = getTransport().httpBase();
	const workspace = encodeURIComponent(workspaceId);
	return oid
		? `${base}${BLOB_ROUTE}/${workspace}/${encodeURIComponent(oid)}/${encodeResourcePath(path)}`
		: `${base}${FILES_ROUTE}/${workspace}/${encodeResourcePath(path)}`;
}

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

// Whether the diff renderer that a file resolves to from its path alone (before its content loads)
// honours the split/unified layout control. Lets a pane-level toggle hide itself when no file in a
// scope can use it, matching the single-file DiffPane's `renderer.capabilities.layout` gate.
export function diffRendererSupportsLayout(
	workspaceId: string,
	path: string,
	scope: GitDiffScope,
	selectedId: string | undefined,
	mobile: boolean,
): boolean {
	const resource = describeResource(workspaceId, path, PENDING_TEXT_META, scope);
	const candidates = resolveRenderers(resource, "diff", { mobile });
	return selectResourceRenderer(candidates, selectedId, path).capabilities.layout;
}

export function useResetViewStateOnImplementationChange(
	workspaceId: string,
	tabId: string,
	implementationKey: string,
): void {
	const previousRef = useRef({ workspaceId, tabId, implementationKey });
	useEffect(() => {
		const previous = previousRef.current;
		previousRef.current = { workspaceId, tabId, implementationKey };
		if (
			previous.workspaceId === workspaceId &&
			previous.tabId === tabId &&
			previous.implementationKey !== implementationKey
		) {
			useAppStore.getState().setTabViewState(workspaceId, tabId, undefined);
		}
	}, [workspaceId, tabId, implementationKey]);
}

export function rendererTestId(rendererId: string): string {
	const suffix = rendererId.startsWith("thinkrail/")
		? rendererId.slice("thinkrail/".length)
		: rendererId.replaceAll("/", "-");
	return `view-toggle-${suffix}`;
}
