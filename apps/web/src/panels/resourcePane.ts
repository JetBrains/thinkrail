import type { ResourceMeta } from "@thinkrail/contracts";
import { useEffect, useRef } from "react";
import type { ResourceRenderer } from "../resources";
import { useAppStore } from "../store";

export const PENDING_TEXT_META: ResourceMeta = { hash: null, byteLength: null, text: true };

export function encodeResourcePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
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
