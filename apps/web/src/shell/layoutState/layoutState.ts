import type { LayoutPreset } from "@thinkrail/contracts";
import { useEffect } from "react";
import { type LayoutAttention, randomId } from "../../lib";
import {
	DEFAULT_LOCAL_LAYOUT_PREFERENCES,
	type LocalLayoutPreferences,
	type LocalLayoutStatePayload,
	toast,
	useAppStore,
} from "../../store";
import { errorText, getTransport } from "../../transport";
import {
	applyProjectedLayoutDocument,
	applyWorkbenchPreset,
	BUILTIN_LAYOUT_PRESETS,
	DEFAULT_LAYOUT_PRESET_ID,
	emptyWorkspaceView,
	ensureWorkbenchToolPlacementIds,
	instantiateWorkbenchFrame,
	LAYOUT_TOOLS,
	minimumBottomGroupLimit,
	minimumSideGroupLimit,
	projectWorkspaceLayout,
	reconcileAttention,
	validateLayoutDocument,
	type WorkbenchFrame,
	type WorkspaceLayoutDocument,
	type WorkspaceViewState,
} from "../layout";

const LOCAL_LAYOUT_VERSION = 1;
const SURFACE_ID_KEY = "thinkrail:layout-surface-id";
const TOOL_IDS = new Set<string>(LAYOUT_TOOLS);

interface PersistedLocalLayout {
	version: 1;
	frame: WorkbenchFrame;
	viewsByWorkspace: Record<string, WorkspaceViewState>;
	attentionByWorkspace: Record<string, LayoutAttention>;
	preferences: LocalLayoutPreferences;
}

interface StoragePair {
	local: Storage;
	session: Storage;
}

let storageOverride: StoragePair | null = null;
let endpointOverride: string | null = null;
let persistenceKey: string | null = null;
let stopPersistence: (() => void) | null = null;
let releaseSurfaceLease: (() => void) | null = null;
let initialization: Promise<void> | null = null;
const workspaceInitializations = new Map<string, Promise<WorkspaceLayoutDocument>>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stores(): StoragePair | null {
	if (storageOverride) return storageOverride;
	if (typeof localStorage === "undefined" || typeof sessionStorage === "undefined") return null;
	return { local: localStorage, session: sessionStorage };
}

export async function claimLayoutSurfaceId(
	storage: Storage,
	claim: (id: string) => Promise<boolean>,
): Promise<string> {
	let id = storage.getItem(SURFACE_ID_KEY) || randomId("surface");
	while (!(await claim(id))) id = randomId("surface");
	storage.setItem(SURFACE_ID_KEY, id);
	return id;
}

function acquireWebLock(name: string): Promise<(() => void) | null | undefined> {
	if (typeof navigator === "undefined" || !navigator.locks) return Promise.resolve(undefined);
	return new Promise((resolve) => {
		let reported = false;
		void navigator.locks
			.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
				reported = true;
				if (!lock) {
					resolve(null);
					return;
				}
				let release: (() => void) | undefined;
				const held = new Promise<void>((done) => {
					release = done;
				});
				resolve(() => release?.());
				await held;
			})
			.catch(() => {
				if (!reported) resolve(undefined);
			});
	});
}

function acquireBroadcastLease(
	endpoint: string,
	id: string,
): Promise<(() => void) | null | undefined> {
	if (typeof BroadcastChannel === "undefined") return Promise.resolve(undefined);
	const channel = new BroadcastChannel(`thinkrail:layout-surfaces:${endpoint}`);
	const token = randomId("surface-claim");
	let occupied = false;
	return new Promise((resolve) => {
		channel.onmessage = (event: MessageEvent<unknown>) => {
			if (!isRecord(event.data) || event.data.id !== id) return;
			if (event.data.type === "probe" && event.data.token !== token) {
				occupied = true;
				channel.postMessage({ type: "occupied", id, token: event.data.token });
				return;
			}
			if (event.data.type === "occupied" && event.data.token === token) occupied = true;
		};
		channel.postMessage({ type: "probe", id, token });
		setTimeout(() => {
			if (occupied) {
				channel.close();
				resolve(null);
				return;
			}
			channel.onmessage = (event: MessageEvent<unknown>) => {
				if (
					isRecord(event.data) &&
					event.data.type === "probe" &&
					event.data.id === id &&
					typeof event.data.token === "string"
				) {
					channel.postMessage({ type: "occupied", id, token: event.data.token });
				}
			};
			resolve(() => channel.close());
		}, 60);
	});
}

function retainSurfaceLease(release: () => void): void {
	let active = true;
	const releaseOnce = () => {
		if (!active) return;
		active = false;
		window.removeEventListener("pagehide", onPageHide);
		release();
		if (releaseSurfaceLease === releaseOnce) releaseSurfaceLease = null;
	};
	const onPageHide = (event: PageTransitionEvent) => {
		if (!event.persisted) releaseOnce();
	};
	releaseSurfaceLease = releaseOnce;
	window.addEventListener("pagehide", onPageHide);
}

async function resolveSurfaceId(storage: StoragePair, endpoint: string): Promise<string> {
	if (storageOverride) return claimLayoutSurfaceId(storage.session, async () => true);
	const pendingLease: { release?: () => void } = {};
	try {
		const id = await claimLayoutSurfaceId(storage.session, async (candidate) => {
			const name = `thinkrail:layout-surface:${JSON.stringify([endpoint, candidate])}`;
			const webLock = await acquireWebLock(name);
			if (webLock === null) return false;
			const lease = webLock ?? (await acquireBroadcastLease(endpoint, candidate));
			if (lease === null) return false;
			if (lease) pendingLease.release = lease;
			return true;
		});
		if (pendingLease.release && typeof window !== "undefined") {
			retainSurfaceLease(pendingLease.release);
		}
		return id;
	} catch (error) {
		pendingLease.release?.();
		throw error;
	}
}

export function localLayoutStorageKey(endpoint: string, id: string): string {
	return `thinkrail:workbench:${JSON.stringify([endpoint, id])}`;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const keys = new Set(allowed);
	return Object.keys(value).every((key) => keys.has(key));
}

function parseAttention(value: unknown): LayoutAttention | undefined {
	if (!isRecord(value)) return undefined;
	const selected = value.selectedByGroup;
	const focused = value.lastFocusedSideGroupId;
	const clocks = value.navigationClockByGroup;
	if (
		!isRecord(selected) ||
		!isRecord(focused) ||
		!isRecord(clocks) ||
		typeof value.lastFocusedCenterGroupId !== "string" ||
		Object.values(selected).some((entry) => typeof entry !== "string") ||
		Object.entries(focused).some(
			([region, entry]) =>
				(region !== "left" && region !== "right" && region !== "bottom") ||
				typeof entry !== "string",
		) ||
		Object.values(clocks).some((entry) => !Number.isSafeInteger(entry) || Number(entry) < 0)
	) {
		return undefined;
	}
	return {
		selectedByGroup: { ...selected } as Record<string, string>,
		lastFocusedCenterGroupId: value.lastFocusedCenterGroupId,
		lastFocusedSideGroupId: { ...focused } as Partial<Record<"left" | "right" | "bottom", string>>,
		navigationClockByGroup: { ...clocks } as Record<string, number>,
	};
}

function isResourceFreeFrame(value: unknown): value is WorkbenchFrame {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["version", "center", "left", "right", "bottom", "toolRestoreTargets"]) ||
		value.version !== 1 ||
		!isRecord(value.center)
	) {
		return false;
	}
	const visitCenter = (node: unknown): boolean => {
		if (!isRecord(node) || typeof node.id !== "string") return false;
		if (node.kind === "group") return hasOnlyKeys(node, ["kind", "id"]);
		return (
			node.kind === "split" &&
			hasOnlyKeys(node, ["kind", "id", "direction", "weights", "children"]) &&
			(node.direction === "horizontal" || node.direction === "vertical") &&
			Array.isArray(node.weights) &&
			node.weights.length === 2 &&
			Array.isArray(node.children) &&
			node.children.length === 2 &&
			visitCenter(node.children[0]) &&
			visitCenter(node.children[1])
		);
	};
	if (!visitCenter(value.center)) return false;
	for (const area of ["left", "right", "bottom"] as const) {
		const region = value[area];
		const regionKeys =
			area === "bottom"
				? ["visible", "height", "alignment", "groups"]
				: ["visible", "width", "groups"];
		if (
			!isRecord(region) ||
			!hasOnlyKeys(region, regionKeys) ||
			typeof region.visible !== "boolean" ||
			(area === "bottom"
				? typeof region.height !== "number" || typeof region.alignment !== "string"
				: typeof region.width !== "number") ||
			!Array.isArray(region.groups)
		) {
			return false;
		}
		for (const group of region.groups) {
			if (
				!isRecord(group) ||
				!hasOnlyKeys(group, ["id", "weight", "folded", "tools"]) ||
				typeof group.id !== "string" ||
				typeof group.weight !== "number" ||
				typeof group.folded !== "boolean" ||
				!Array.isArray(group.tools)
			) {
				return false;
			}
			if (
				group.tools.some(
					(tool) =>
						!isRecord(tool) ||
						!hasOnlyKeys(tool, ["kind", "id", "name", "tool"]) ||
						tool.kind !== "tool" ||
						typeof tool.id !== "string" ||
						typeof tool.name !== "string" ||
						typeof tool.tool !== "string" ||
						!TOOL_IDS.has(tool.tool),
				)
			) {
				return false;
			}
		}
	}
	if (!isRecord(value.toolRestoreTargets)) return false;
	return Object.entries(value.toolRestoreTargets).every(([tool, candidate]) => {
		if (!TOOL_IDS.has(tool) || !isRecord(candidate)) return false;
		return (
			hasOnlyKeys(candidate, ["region", "groupId", "index"]) &&
			(candidate.region === "left" ||
				candidate.region === "right" ||
				candidate.region === "bottom") &&
			(candidate.groupId === undefined || typeof candidate.groupId === "string") &&
			Number.isInteger(candidate.index) &&
			Number(candidate.index) >= 0
		);
	});
}

function isWorkspaceView(value: unknown): value is WorkspaceViewState {
	if (!isRecord(value) || !hasOnlyKeys(value, ["groups"]) || !isRecord(value.groups)) {
		return false;
	}
	const validDiffScope = (scope: unknown): boolean => {
		if (!isRecord(scope) || typeof scope.kind !== "string") return false;
		switch (scope.kind) {
			case "branch":
			case "uncommitted":
				return hasOnlyKeys(scope, ["kind"]);
			case "commit":
				return hasOnlyKeys(scope, ["kind", "sha"]) && typeof scope.sha === "string";
			case "pinned":
				return hasOnlyKeys(scope, ["kind", "baseRef"]) && typeof scope.baseRef === "string";
			default:
				return false;
		}
	};
	const validTab = (tab: unknown): boolean => {
		if (
			!isRecord(tab) ||
			typeof tab.kind !== "string" ||
			typeof tab.id !== "string" ||
			typeof tab.name !== "string"
		) {
			return false;
		}
		switch (tab.kind) {
			case "file":
				return hasOnlyKeys(tab, ["kind", "id", "name", "path"]) && typeof tab.path === "string";
			case "diff":
				return (
					hasOnlyKeys(tab, ["kind", "id", "name", "path", "scope"]) &&
					typeof tab.path === "string" &&
					validDiffScope(tab.scope)
				);
			case "chat":
				return (
					hasOnlyKeys(tab, ["kind", "id", "name", "sessionId"]) && typeof tab.sessionId === "string"
				);
			case "document":
				return (
					hasOnlyKeys(tab, ["kind", "id", "name", "documentKind", "sourceId", "docPath"]) &&
					tab.documentKind === "todo-plan" &&
					typeof tab.sourceId === "string" &&
					typeof tab.docPath === "string"
				);
			case "terminal":
				return hasOnlyKeys(tab, ["kind", "id", "name", "tabKey"]) && typeof tab.tabKey === "string";
			default:
				return false;
		}
	};
	return Object.values(value.groups).every((candidate) => {
		if (
			!isRecord(candidate) ||
			!hasOnlyKeys(candidate, ["tabs", "previewTabId", "beforeToolByTabId"]) ||
			!Array.isArray(candidate.tabs) ||
			candidate.tabs.some((tab) => !validTab(tab)) ||
			(candidate.previewTabId !== undefined && typeof candidate.previewTabId !== "string") ||
			(candidate.beforeToolByTabId !== undefined && !isRecord(candidate.beforeToolByTabId))
		) {
			return false;
		}
		return (
			candidate.beforeToolByTabId === undefined ||
			Object.values(candidate.beforeToolByTabId).every(
				(tool) => typeof tool === "string" && TOOL_IDS.has(tool),
			)
		);
	});
}

function frameGroupIds(frame: WorkbenchFrame): Set<string> {
	const ids = new Set<string>();
	const visitCenter = (node: WorkbenchFrame["center"]): void => {
		if (node.kind === "group") {
			ids.add(node.id);
			return;
		}
		visitCenter(node.children[0]);
		visitCenter(node.children[1]);
	};
	visitCenter(frame.center);
	for (const region of [frame.left, frame.right, frame.bottom]) {
		for (const group of region.groups) ids.add(group.id);
	}
	return ids;
}

function parsePreferences(value: unknown): LocalLayoutPreferences | undefined {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.defaultPresetId !== "string" ||
		!Number.isInteger(value.maxSideGroups) ||
		Number(value.maxSideGroups) < 1 ||
		Number(value.maxSideGroups) > 32 ||
		!Number.isInteger(value.maxBottomGroups) ||
		Number(value.maxBottomGroups) < 1 ||
		Number(value.maxBottomGroups) > 32
	) {
		return undefined;
	}
	return {
		defaultPresetId: value.defaultPresetId,
		maxSideGroups: Number(value.maxSideGroups),
		maxBottomGroups: Number(value.maxBottomGroups),
	};
}

function decodeLocalLayout(raw: string): LocalLayoutStatePayload | undefined {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			!isRecord(parsed) ||
			parsed.version !== LOCAL_LAYOUT_VERSION ||
			!hasOnlyKeys(parsed, [
				"version",
				"frame",
				"viewsByWorkspace",
				"attentionByWorkspace",
				"preferences",
			])
		) {
			return undefined;
		}
		if (!isResourceFreeFrame(parsed.frame)) return undefined;
		if (!isRecord(parsed.viewsByWorkspace) || !isRecord(parsed.attentionByWorkspace)) {
			return undefined;
		}
		const preferences = parsePreferences(parsed.preferences);
		if (!preferences) return undefined;
		const frame = parsed.frame;
		const validGroupIds = frameGroupIds(frame);
		const viewsByWorkspace: Record<string, WorkspaceViewState> = {};
		const documentsByWorkspace: Record<string, WorkspaceLayoutDocument> = {};
		const attentionByWorkspace: Record<string, LayoutAttention> = {};
		for (const [workspaceId, view] of Object.entries(parsed.viewsByWorkspace)) {
			if (!isWorkspaceView(view) || Object.keys(view.groups).some((id) => !validGroupIds.has(id))) {
				return undefined;
			}
			viewsByWorkspace[workspaceId] = view;
			const document = projectWorkspaceLayout(frame, view);
			if (validateLayoutDocument(document, 32, 32).length > 0) return undefined;
			documentsByWorkspace[workspaceId] = document;
			attentionByWorkspace[workspaceId] = reconcileAttention(
				document,
				parseAttention(parsed.attentionByWorkspace[workspaceId]),
			);
		}
		if (Object.keys(documentsByWorkspace).length === 0) {
			const frameDocument = projectWorkspaceLayout(frame, emptyWorkspaceView());
			if (validateLayoutDocument(frameDocument, 32, 32).length > 0) return undefined;
		}
		return {
			frame,
			viewsByWorkspace,
			documentsByWorkspace,
			attentionByWorkspace,
			preferences,
		};
	} catch {
		return undefined;
	}
}

function encodeLocalLayout(state: ReturnType<typeof useAppStore.getState>): string | null {
	if (!state.layoutStateReady || !state.workbenchFrame) return null;
	const value: PersistedLocalLayout = {
		version: LOCAL_LAYOUT_VERSION,
		frame: state.workbenchFrame,
		viewsByWorkspace: state.workspaceViewsByWorkspace,
		attentionByWorkspace: state.layoutAttentionByWorkspace,
		preferences: state.localLayoutPreferences,
	};
	return JSON.stringify(value);
}

function persistCurrentLayout(): void {
	const storage = stores();
	if (!storage || !persistenceKey) return;
	const encoded = encodeLocalLayout(useAppStore.getState());
	if (!encoded) return;
	try {
		storage.local.setItem(persistenceKey, encoded);
	} catch (error) {
		toast.error(errorText(error), "Couldn't save the local layout");
	}
}

function startPersistence(): void {
	if (stopPersistence) return;
	stopPersistence = useAppStore.subscribe((state, previous) => {
		if (
			state.workbenchFrame === previous.workbenchFrame &&
			state.workspaceViewsByWorkspace === previous.workspaceViewsByWorkspace &&
			state.layoutAttentionByWorkspace === previous.layoutAttentionByWorkspace &&
			state.localLayoutPreferences === previous.localLayoutPreferences &&
			state.layoutStateReady === previous.layoutStateReady
		) {
			return;
		}
		persistCurrentLayout();
	});
}

async function loadPersistedLayout(): Promise<LocalLayoutStatePayload | undefined> {
	const storage = stores();
	if (!storage) return undefined;
	try {
		const endpoint = endpointOverride ?? getTransport().httpBase();
		const id = await resolveSurfaceId(storage, endpoint);
		persistenceKey = localLayoutStorageKey(endpoint, id);
		const raw = storage.local.getItem(persistenceKey);
		return raw ? decodeLocalLayout(raw) : undefined;
	} catch {
		persistenceKey = null;
		return undefined;
	}
}

function balancedFrame(): WorkbenchFrame {
	const preset = BUILTIN_LAYOUT_PRESETS.find(
		(candidate) => candidate.id === DEFAULT_LAYOUT_PRESET_ID,
	);
	if (!preset) throw new Error("The Balanced layout preset is missing");
	return instantiateWorkbenchFrame(preset);
}

function documentsForViews(
	frame: WorkbenchFrame,
	views: Record<string, WorkspaceViewState>,
): Record<string, WorkspaceLayoutDocument> {
	return Object.fromEntries(
		Object.entries(views).map(([workspaceId, view]) => [
			workspaceId,
			projectWorkspaceLayout(frame, view),
		]),
	);
}

export function initializeLocalLayoutState(): Promise<void> {
	if (initialization) return initialization;
	const run = (async () => {
		const state = useAppStore.getState();
		if (!state.layoutStateReady) {
			const persisted = await loadPersistedLayout();
			if (persisted) {
				state.hydrateLocalLayoutState(persisted);
			} else {
				state.hydrateLocalLayoutState({
					frame: balancedFrame(),
					viewsByWorkspace: {},
					documentsByWorkspace: {},
					attentionByWorkspace: {},
					preferences: { ...DEFAULT_LOCAL_LAYOUT_PREFERENCES },
				});
			}
		}
		startPersistence();
	})();
	initialization = run.catch((error) => {
		initialization = null;
		throw error;
	});
	return initialization;
}

export function ensureWorkspaceLayoutState(workspaceId: string): Promise<WorkspaceLayoutDocument> {
	const existing = workspaceInitializations.get(workspaceId);
	if (existing) return existing;
	const request = (async () => {
		if (useAppStore.getState().removedWorkspaceIds[workspaceId]) {
			throw new Error("Workspace has been removed");
		}
		await initializeLocalLayoutState();
		const state = useAppStore.getState();
		if (state.removedWorkspaceIds[workspaceId]) throw new Error("Workspace has been removed");
		const existingDocument = state.layoutDocumentsByWorkspace[workspaceId];
		if (existingDocument) return existingDocument;
		if (!state.workbenchFrame) throw new Error("The local workbench frame is not ready");
		const view = emptyWorkspaceView();
		const document = projectWorkspaceLayout(state.workbenchFrame, view);
		state.applyLocalLayoutState(
			{
				frame: state.workbenchFrame,
				viewsByWorkspace: { ...state.workspaceViewsByWorkspace, [workspaceId]: view },
				documentsByWorkspace: {
					...state.layoutDocumentsByWorkspace,
					[workspaceId]: document,
				},
				attentionByWorkspace: {
					...state.layoutAttentionByWorkspace,
					[workspaceId]: reconcileAttention(document, undefined),
				},
				preferences: state.localLayoutPreferences,
			},
			[workspaceId],
		);
		const installed = useAppStore.getState().layoutDocumentsByWorkspace[workspaceId];
		if (!installed) throw new Error("The workspace layout could not be initialized");
		return installed;
	})().finally(() => {
		if (workspaceInitializations.get(workspaceId) === request) {
			workspaceInitializations.delete(workspaceId);
		}
	});
	workspaceInitializations.set(workspaceId, request);
	return request;
}

export function applyLayoutPresetLocally(preset: LayoutPreset): void {
	const state = useAppStore.getState();
	if (!state.workbenchFrame) throw new Error("The local workbench frame is not ready");
	const next = applyWorkbenchPreset(
		{ frame: state.workbenchFrame, viewsByWorkspace: state.workspaceViewsByWorkspace },
		preset,
	);
	const documentsByWorkspace = documentsForViews(next.frame, next.viewsByWorkspace);
	const attentionByWorkspace: Record<string, LayoutAttention> = {};
	for (const [workspaceId, document] of Object.entries(documentsByWorkspace)) {
		attentionByWorkspace[workspaceId] = reconcileAttention(
			document,
			state.layoutAttentionByWorkspace[workspaceId],
			state.layoutDocumentsByWorkspace[workspaceId],
		);
	}
	state.applyLocalLayoutState(
		{
			frame: next.frame,
			viewsByWorkspace: next.viewsByWorkspace,
			documentsByWorkspace,
			attentionByWorkspace,
			preferences: {
				...state.localLayoutPreferences,
				maxSideGroups: Math.max(
					state.localLayoutPreferences.maxSideGroups,
					minimumSideGroupLimit(preset),
				),
				maxBottomGroups: Math.max(
					state.localLayoutPreferences.maxBottomGroups,
					minimumBottomGroupLimit(preset),
				),
			},
		},
		Object.keys(documentsByWorkspace),
		true,
	);
}

function rebaseProjectedDocument(
	base: WorkspaceLayoutDocument,
	next: WorkspaceLayoutDocument,
	current: WorkspaceLayoutDocument,
): WorkspaceLayoutDocument {
	if (current === base) return next;
	return {
		version: 2,
		center: next.center === base.center ? current.center : next.center,
		left: next.left === base.left ? current.left : next.left,
		right: next.right === base.right ? current.right : next.right,
		bottom: next.bottom === base.bottom ? current.bottom : next.bottom,
		toolRestoreTargets:
			next.toolRestoreTargets === base.toolRestoreTargets
				? current.toolRestoreTargets
				: next.toolRestoreTargets,
	};
}

export async function commitWorkspaceLayout(
	workspaceId: string,
	document: WorkspaceLayoutDocument,
	baseDocument?: WorkspaceLayoutDocument,
): Promise<WorkspaceLayoutDocument> {
	const state = useAppStore.getState();
	if (state.removedWorkspaceIds[workspaceId]) throw new Error("Workspace has been removed");
	if (!state.workbenchFrame) throw new Error("The local workbench frame is not ready");
	const currentDocument = state.layoutDocumentsByWorkspace[workspaceId];
	const effectiveDocument =
		baseDocument && currentDocument
			? rebaseProjectedDocument(baseDocument, document, currentDocument)
			: document;
	const validationErrors = validateLayoutDocument(effectiveDocument, 32, 32);
	if (validationErrors.length > 0) throw new Error(validationErrors.join(" "));
	const projected = applyProjectedLayoutDocument(
		{ frame: state.workbenchFrame, viewsByWorkspace: state.workspaceViewsByWorkspace },
		workspaceId,
		effectiveDocument,
	);
	const frame = ensureWorkbenchToolPlacementIds(projected.frame, projected.viewsByWorkspace);
	const frameChanged = frame !== state.workbenchFrame;
	const documentsByWorkspace = frameChanged
		? documentsForViews(frame, projected.viewsByWorkspace)
		: { ...state.layoutDocumentsByWorkspace, [workspaceId]: effectiveDocument };
	const changedWorkspaceIds = frameChanged ? Object.keys(documentsByWorkspace) : [workspaceId];
	const attentionByWorkspace = { ...state.layoutAttentionByWorkspace };
	for (const id of changedWorkspaceIds) {
		const nextDocument = documentsByWorkspace[id];
		if (!nextDocument) continue;
		attentionByWorkspace[id] = reconcileAttention(
			nextDocument,
			state.layoutAttentionByWorkspace[id],
			state.layoutDocumentsByWorkspace[id],
		);
	}
	state.applyLocalLayoutState(
		{
			frame,
			viewsByWorkspace: projected.viewsByWorkspace,
			documentsByWorkspace,
			attentionByWorkspace,
			preferences: state.localLayoutPreferences,
		},
		changedWorkspaceIds,
		frameChanged,
	);
	return useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] ?? document;
}

export function useLocalLayoutState(): void {
	useEffect(() => {
		void initializeLocalLayoutState().catch((error) => {
			toast.error(errorText(error), "Couldn't load the local layout");
		});
	}, []);
}

export function useWorkspaceLayoutState(workspaceId: string): void {
	useEffect(() => {
		void ensureWorkspaceLayoutState(workspaceId).catch((error) => {
			if (!useAppStore.getState().removedWorkspaceIds[workspaceId]) {
				toast.error(errorText(error), "Couldn't load the local layout");
			}
		});
	}, [workspaceId]);
}

export function setLayoutStateStorageForTests(
	storage: StoragePair | null,
	endpoint: string | null = null,
): void {
	storageOverride = storage;
	endpointOverride = endpoint;
}

export function resetLayoutStateForTests(): void {
	workspaceInitializations.clear();
	stopPersistence?.();
	stopPersistence = null;
	releaseSurfaceLease?.();
	releaseSurfaceLease = null;
	initialization = null;
	persistenceKey = null;
	storageOverride = null;
	endpointOverride = null;
}
