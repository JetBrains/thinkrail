import type { ResourceMeta } from "@thinkrail/contracts";
import { useEffect, useRef } from "react";
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
