import type { NativeDeepLinkBridge, NativeOpenFileRequest } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { pathWithinRoot } from "../lib";
import { openFileAtLine } from "../panels/openTabs";
import { resolveOpenWorkspaceForPath } from "../panels/workspaceForPath";
import { toast, useAppStore } from "../store";
import { paletteNavigator } from "./paletteNavigation";

const NATIVE_DEEP_LINKS_GLOBAL = "__THINKRAIL_NATIVE_DEEP_LINKS__";
const MAX_POSITION = 2_000_000;

function position(value: unknown): number | undefined {
	return typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0 &&
		value <= MAX_POSITION
		? value
		: undefined;
}

export function getNativeDeepLinkBridge(value: unknown): NativeDeepLinkBridge | null {
	if (typeof value !== "object" || value === null) return null;
	const subscribe = Reflect.get(value, "subscribe");
	return typeof subscribe === "function" ? (value as NativeDeepLinkBridge) : null;
}

function waitForWelcome(): Promise<void> {
	if (useAppStore.getState().welcomeGeneration > 0) return Promise.resolve();
	return new Promise((resolve) => {
		const unsubscribe = useAppStore.subscribe((state) => {
			if (state.welcomeGeneration === 0) return;
			unsubscribe();
			resolve();
		});
	});
}

function fileTabOpen(workspaceId: string, path: string): boolean {
	return (useAppStore.getState().tabsByWorkspace[workspaceId] ?? []).some(
		(tab) => tab.kind === "file" && tab.path === path,
	);
}

export async function openDeepLink(
	request: NativeOpenFileRequest,
	navigateToWorkspace = paletteNavigator.navigateToWorkspace,
): Promise<void> {
	await waitForWelcome();
	const workspace = await resolveOpenWorkspaceForPath(request.file);
	const path = workspace ? pathWithinRoot(request.file, workspace.worktreePath) : null;
	if (!workspace || !path) {
		toast.error(t("shell.deepLink.notInProject", { path: request.file }));
		return;
	}
	if (!(await navigateToWorkspace(workspace))) return;
	const column = position(request.column);
	await openFileAtLine(
		workspace.id,
		path,
		{ line: position(request.line) ?? 1, ...(column === undefined ? {} : { column }) },
		"keep",
	);
	if (!fileTabOpen(workspace.id, path)) {
		toast.error(t("shell.deepLink.openFailed", { path: request.file }));
	}
}

export function installDeepLinks(
	bridge = getNativeDeepLinkBridge(Reflect.get(globalThis, NATIVE_DEEP_LINKS_GLOBAL)),
): void {
	if (!bridge) return;
	let queue = Promise.resolve();
	bridge.subscribe((request) => {
		queue = queue
			.then(() => openDeepLink(request))
			.catch(() => {
				toast.error(t("shell.deepLink.openFailed", { path: request.file }));
			});
	});
}
