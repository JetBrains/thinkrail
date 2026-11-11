import type { NativeDeepLinkBridge, NativeOpenFileRequest, Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { normalizePath, projectRelativePath } from "../lib";
import { toast, useAppStore } from "../store";
import { getTransport } from "../transport";

const NATIVE_DEEP_LINKS_GLOBAL = "__THINKRAIL_NATIVE_DEEP_LINKS__";

function comparable(path: string): string {
	const normalized = normalizePath(path).replace(/\/+$/, "");
	const value = normalized.length === 0 ? "/" : normalized;
	return /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value;
}

export function fileIsInsideWorkspace(file: string, worktreePath: string): boolean {
	const target = comparable(file);
	const root = comparable(worktreePath);
	return target === root || target.startsWith(root === "/" ? "/" : `${root}/`);
}

/**
 * The active workspace wins only against an equal-length root; a nested workspace is always
 * more specific than the project folder that contains it.
 */
export function findWorkspaceForFile(
	file: string,
	workspaces: readonly Workspace[],
	activeWorkspaceId: string | null = null,
): Workspace | null {
	let best: Workspace | null = null;
	let bestLength = -1;
	for (const workspace of workspaces) {
		if (!fileIsInsideWorkspace(file, workspace.worktreePath)) continue;
		const length = comparable(workspace.worktreePath).length;
		if (length > bestLength || (length === bestLength && workspace.id === activeWorkspaceId)) {
			best = workspace;
			bestLength = length;
		}
	}
	return best;
}

/** The identity `openFileAtLine` both opens and reveals; an absolute path only matches the open tab. */
export function workspaceFilePath(file: string, workspace: Workspace): string {
	return projectRelativePath(file, workspace.worktreePath);
}

export function getNativeDeepLinkBridge(value: unknown): NativeDeepLinkBridge | null {
	if (typeof value !== "object" || value === null) return null;
	const subscribe = Reflect.get(value, "subscribe");
	return typeof subscribe === "function" ? (value as NativeDeepLinkBridge) : null;
}

function loadedWorkspaces(): Workspace[] {
	const state = useAppStore.getState();
	const openProjects = new Set(state.projects.map((project) => project.id));
	return Object.values(state.workspaces)
		.flat()
		.filter((workspace) => openProjects.has(workspace.projectId));
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

async function loadProjectWorkspaces(projectIds: readonly string[]): Promise<void> {
	for (const projectId of projectIds) {
		if (useAppStore.getState().workspaces[projectId] !== undefined) continue;
		try {
			const rows = await getTransport().request("workspace.list", {
				projectId,
				includeDiffStats: false,
			});
			useAppStore.getState().setWorkspaces(projectId, rows);
		} catch {
			// A project whose list cannot be read simply contributes no candidates.
		}
	}
}

async function resolveWorkspace(file: string): Promise<Workspace | null> {
	const state = useAppStore.getState();
	const cached = findWorkspaceForFile(file, loadedWorkspaces(), state.activeWorkspaceId);
	const likely = state.projects.filter((project) => fileIsInsideWorkspace(file, project.path));
	await loadProjectWorkspaces(likely.map((project) => project.id));
	const mostSpecific = findWorkspaceForFile(
		file,
		loadedWorkspaces(),
		useAppStore.getState().activeWorkspaceId,
	);
	if (mostSpecific) return mostSpecific;
	if (cached) return cached;
	const likelyIds = new Set(likely.map((project) => project.id));
	const remaining = state.projects.filter((project) => !likelyIds.has(project.id));
	await loadProjectWorkspaces(remaining.map((project) => project.id));
	return findWorkspaceForFile(file, loadedWorkspaces(), useAppStore.getState().activeWorkspaceId);
}

export async function openDeepLink(request: NativeOpenFileRequest): Promise<void> {
	await waitForWelcome();
	const workspace = await resolveWorkspace(request.file);
	if (
		!workspace ||
		!useAppStore.getState().projects.some((project) => project.id === workspace.projectId)
	) {
		toast.error(t("shell.deepLink.openFailed", { path: request.file }));
		return;
	}
	useAppStore.getState().activateWorkspace({ id: workspace.id, projectId: workspace.projectId });
	const line = Number.isSafeInteger(request.line) && request.line > 0 ? request.line : 1;
	const column =
		request.column !== undefined && Number.isSafeInteger(request.column) && request.column > 0
			? request.column
			: undefined;
	const { openFileAtLine } = await import("../panels/openTabs");
	await openFileAtLine(
		workspace.id,
		workspaceFilePath(request.file, workspace),
		{ line, ...(column === undefined ? {} : { column }) },
		"keep",
	);
}

const pending: NativeOpenFileRequest[] = [];
let draining = false;
let installed = false;

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	try {
		while (pending.length > 0) {
			const request = pending.shift();
			if (request) await openDeepLink(request);
		}
	} finally {
		draining = false;
	}
}

/**
 * Desktop-only. A browser has no native bridge, so this is a no-op there; the preload queues
 * requests that arrive before React has subscribed.
 */
export function installDeepLinks(
	bridge: NativeDeepLinkBridge | null = getNativeDeepLinkBridge(
		Reflect.get(globalThis, NATIVE_DEEP_LINKS_GLOBAL),
	),
): void {
	if (!bridge || installed) return;
	installed = true;
	bridge.subscribe((request) => {
		pending.push(request);
		void drain();
	});
}
