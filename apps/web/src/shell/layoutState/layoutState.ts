import {
	isLayoutToolId,
	type LayoutPreset,
	type LayoutPresetBottomRegion,
	type LayoutPresetSideRegion,
} from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { useEffect, useLayoutEffect } from "react";
import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../../clientPreferences";
import { type LayoutAttention, randomId, sameLayoutAttention } from "../../lib";
import {
	DEFAULT_LOCAL_LAYOUT_PREFERENCES,
	type LocalLayoutPreferences,
	type LocalLayoutStatePayload,
	type LocalLayoutView,
	toast,
	useAppStore,
} from "../../store";
import { errorText, getTransport } from "../../transport";
import {
	adoptToolSelections,
	applyProjectedLayoutDocument,
	applyWorkbenchPreset,
	arrangeWorkbenchView,
	BUILTIN_LAYOUT_PRESETS,
	captureWorkbenchSides,
	changedToolSelections,
	DEFAULT_LAYOUT_PRESET_ID,
	emptyWorkspaceView,
	ensureWorkbenchToolPlacementIds,
	instantiateWorkbenchFrame,
	minimumBottomGroupLimit,
	minimumSideGroupLimit,
	type NormalizedLayoutState,
	normalizePeekWidth,
	normalizeWorkspaceView,
	projectWorkspaceLayout,
	reconcileAttention,
	restoreWorkbenchSides,
	sameWorkbenchFrameShape,
	validateLayoutDocument,
	type WorkbenchFrame,
	type WorkbenchViewArrangement,
	type WorkspaceLayoutDocument,
	type WorkspaceViewState,
} from "../layout";

const LOCAL_LAYOUT_VERSION = 1;
const SURFACE_ID_KEY = "thinkrail:layout-surface-id";
const NATIVE_LAYOUT_PREFERENCE_KEY = "workbench-layout";
const NATIVE_LAYOUT_MAX_CHARACTERS = 256 * 1024;

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
let stablePreferenceOverride: StablePreferenceAdapter | null | undefined;
let persistenceKey: string | null = null;
let activeStablePreferences: StablePreferenceAdapter | null = null;
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
						!isLayoutToolId(tool.tool),
				)
			) {
				return false;
			}
		}
	}
	if (!isRecord(value.toolRestoreTargets)) return false;
	return Object.entries(value.toolRestoreTargets).every(([tool, candidate]) => {
		if (!isLayoutToolId(tool) || !isRecord(candidate)) return false;
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
			case "turn":
				return (
					hasOnlyKeys(scope, ["kind", "id", "baseTree", "headTree", "startedAt"]) &&
					typeof scope.id === "string" &&
					typeof scope.baseTree === "string" &&
					typeof scope.headTree === "string" &&
					typeof scope.startedAt === "number"
				);
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
					typeof tab.path === "string" &&
					(tab.before === undefined
						? hasOnlyKeys(tab, ["kind", "id", "name", "path", "scope"]) && validDiffScope(tab.scope)
						: hasOnlyKeys(tab, ["kind", "id", "name", "path", "before"]) &&
							typeof tab.before === "string")
				);
			case "changes":
				return hasOnlyKeys(tab, ["kind", "id", "name", "scope"]) && validDiffScope(tab.scope);
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
			case "extension":
				return (
					hasOnlyKeys(tab, ["kind", "id", "name", "extension", "panel", "titleKey", "params"]) &&
					typeof tab.extension === "string" &&
					typeof tab.panel === "string" &&
					typeof tab.titleKey === "string" &&
					isRecord(tab.params) &&
					Object.values(tab.params).every((value) => typeof value === "string")
				);
			default:
				return false;
		}
	};
	return Object.values(value.groups).every(
		(candidate) =>
			isRecord(candidate) &&
			hasOnlyKeys(candidate, ["tabs", "previewTabId", "beforeToolByTabId"]) &&
			Array.isArray(candidate.tabs) &&
			candidate.tabs.every((tab) => validTab(tab)) &&
			(candidate.previewTabId === undefined || typeof candidate.previewTabId === "string"),
	);
}

function retainedWorkspaceView(view: WorkspaceViewState): WorkspaceViewState {
	return {
		groups: Object.fromEntries(
			Object.entries(view.groups).map(([groupId, group]) => [
				groupId,
				{ tabs: group.tabs, ...(group.previewTabId ? { previewTabId: group.previewTabId } : {}) },
			]),
		),
	};
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

const MAX_VIEW_GROUPS = 32;
const MAX_VIEW_ID = 200;
const BOTTOM_ALIGNMENTS: readonly LayoutPresetBottomRegion["alignment"][] = [
	"center",
	"center-left",
	"center-right",
	"full",
];

function parseViewGroups(value: unknown): LayoutPresetSideRegion["groups"] | undefined {
	if (!Array.isArray(value) || value.length > MAX_VIEW_GROUPS) return undefined;
	const groups: LayoutPresetSideRegion["groups"] = [];
	for (const group of value) {
		if (
			!isRecord(group) ||
			typeof group.id !== "string" ||
			typeof group.weight !== "number" ||
			!(group.weight > 0 && Number.isFinite(group.weight)) ||
			typeof group.folded !== "boolean" ||
			!Array.isArray(group.tools) ||
			!group.tools.every(isLayoutToolId)
		) {
			return undefined;
		}
		groups.push({
			id: group.id,
			weight: group.weight,
			folded: group.folded,
			tools: [...group.tools],
		});
	}
	return groups;
}

function parseViewSide(value: unknown): LayoutPresetSideRegion | undefined {
	if (
		!isRecord(value) ||
		typeof value.visible !== "boolean" ||
		typeof value.width !== "number" ||
		!(value.width > 0 && value.width < 1)
	) {
		return undefined;
	}
	const groups = parseViewGroups(value.groups);
	return groups ? { visible: value.visible, width: value.width, groups } : undefined;
}

function parseViewBottom(value: unknown): LayoutPresetBottomRegion | undefined {
	if (
		!isRecord(value) ||
		typeof value.visible !== "boolean" ||
		typeof value.height !== "number" ||
		!(value.height > 0 && value.height < 1) ||
		!BOTTOM_ALIGNMENTS.includes(value.alignment as LayoutPresetBottomRegion["alignment"])
	) {
		return undefined;
	}
	const groups = parseViewGroups(value.groups);
	return groups
		? {
				visible: value.visible,
				height: value.height,
				alignment: value.alignment as LayoutPresetBottomRegion["alignment"],
				groups,
			}
		: undefined;
}

/**
 * A malformed or partial view is dropped on its own: the frame, views and other preferences stand. A former
 * Board mode (`layoutMode`, which captured only the sides) becomes its view, `migrated`, with the frame's
 * bottom as that mode left it: the shell re-enters the view over the restored frame.
 */
function parseLayoutView(
	value: unknown,
	legacy: unknown,
	frame: WorkbenchFrame,
): LocalLayoutView | undefined {
	const migrated = !isRecord(value) && isRecord(legacy);
	const source = migrated ? legacy : value;
	if (!isRecord(source) || typeof source.id !== "string" || source.id.length > MAX_VIEW_ID) {
		return undefined;
	}
	const restore = isRecord(source.restore) ? source.restore : {};
	const left = parseViewSide(restore.left);
	const right = parseViewSide(restore.right);
	const bottom = migrated ? captureWorkbenchSides(frame).bottom : parseViewBottom(restore.bottom);
	if (!left || !right || !bottom || left.width + right.width >= 1) return undefined;
	const selected = isRecord(source.selected)
		? Object.fromEntries(
				Object.entries(source.selected).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				),
			)
		: {};
	const restoreTargets: WorkbenchFrame["toolRestoreTargets"] = {};
	for (const [tool, target] of Object.entries(
		isRecord(source.restoreTargets) ? source.restoreTargets : {},
	)) {
		if (
			isLayoutToolId(tool) &&
			isRecord(target) &&
			(target.region === "left" || target.region === "right" || target.region === "bottom") &&
			(target.groupId === undefined || typeof target.groupId === "string") &&
			Number.isInteger(target.index) &&
			Number(target.index) >= 0
		) {
			restoreTargets[tool] = {
				region: target.region,
				...(typeof target.groupId === "string" ? { groupId: target.groupId } : {}),
				index: Number(target.index),
			};
		}
	}
	return {
		id: source.id,
		restore: { left, right, bottom },
		restoreTargets,
		selected,
		...(migrated || source.migrated === true ? { migrated: true as const } : {}),
	};
}

function parsePreferences(
	value: unknown,
	frame: WorkbenchFrame,
): LocalLayoutPreferences | undefined {
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
	const peekWidth = normalizePeekWidth(value.peekWidth);
	const layoutView = parseLayoutView(value.layoutView, value.layoutMode, frame);
	return {
		defaultPresetId: value.defaultPresetId,
		maxSideGroups: Number(value.maxSideGroups),
		maxBottomGroups: Number(value.maxBottomGroups),
		...(peekWidth === undefined ? {} : { peekWidth }),
		...(layoutView ? { layoutView } : {}),
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
		const frame = parsed.frame;
		const preferences = parsePreferences(parsed.preferences, frame);
		if (!preferences) return undefined;
		const validGroupIds = frameGroupIds(frame);
		const viewsByWorkspace: Record<string, WorkspaceViewState> = {};
		const documentsByWorkspace: Record<string, WorkspaceLayoutDocument> = {};
		const attentionByWorkspace: Record<string, LayoutAttention> = {};
		for (const [workspaceId, view] of Object.entries(parsed.viewsByWorkspace)) {
			if (!isWorkspaceView(view) || Object.keys(view.groups).some((id) => !validGroupIds.has(id))) {
				return undefined;
			}
			const normalized = normalizeWorkspaceView(frame, retainedWorkspaceView(view));
			viewsByWorkspace[workspaceId] = normalized;
			const document = projectWorkspaceLayout(frame, normalized);
			if (validateLayoutDocument(document, 32, 32).length > 0) return undefined;
			documentsByWorkspace[workspaceId] = document;
			attentionByWorkspace[workspaceId] = reconcileAttention(
				document,
				parseAttention(parsed.attentionByWorkspace[workspaceId]),
			);
		}
		if (Object.keys(documentsByWorkspace).length === 0) {
			const frameDocument = emptyWorkspaceProjection(frame).document;
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
	const encoded = encodeLocalLayout(useAppStore.getState());
	if (!encoded) return;
	try {
		if (activeStablePreferences) {
			if (encoded.length > NATIVE_LAYOUT_MAX_CHARACTERS) {
				throw new Error(t("workbench.layoutState.tooLargeForNative"));
			}
			activeStablePreferences.setItem(NATIVE_LAYOUT_PREFERENCE_KEY, encoded);
			return;
		}
		const storage = stores();
		if (!storage || !persistenceKey) return;
		storage.local.setItem(persistenceKey, encoded);
	} catch (error) {
		toast.error(errorText(error), t("workbench.layoutState.saveFailed"));
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
	activeStablePreferences =
		stablePreferenceOverride === undefined
			? getStablePreferenceAdapter()
			: stablePreferenceOverride;
	if (activeStablePreferences) {
		persistenceKey = null;
		try {
			const raw = activeStablePreferences.getItem(NATIVE_LAYOUT_PREFERENCE_KEY);
			return raw ? decodeLocalLayout(raw) : undefined;
		} catch {
			return undefined;
		}
	}
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

export function emptyWorkspaceProjection(
	frame: WorkbenchFrame,
	reference?: { document: WorkspaceLayoutDocument; attention: LayoutAttention },
): {
	view: WorkspaceViewState;
	document: WorkspaceLayoutDocument;
	attention: LayoutAttention;
} {
	const view = emptyWorkspaceView();
	const document = projectWorkspaceLayout(frame, view);
	const reconciled = reconcileAttention(document, undefined);
	return {
		view,
		document,
		attention: reference
			? adoptToolSelections(reconciled, document, reference.attention, reference.document)
			: reconciled,
	};
}

export function workspaceProjectionReference(
	workspaceId: string,
): { document: WorkspaceLayoutDocument; attention: LayoutAttention } | undefined {
	const state = useAppStore.getState();
	for (const id of state.workspaceSelectionHistory) {
		if (id === workspaceId || state.removedWorkspaceIds[id]) continue;
		const document = state.layoutDocumentsByWorkspace[id];
		const attention = state.layoutAttentionByWorkspace[id];
		if (document && attention) return { document, attention };
	}
	return undefined;
}

function installWorkspaceView(workspaceId: string): WorkspaceLayoutDocument {
	const state = useAppStore.getState();
	if (state.removedWorkspaceIds[workspaceId]) throw new Error("Workspace has been removed");
	const existingDocument = state.layoutDocumentsByWorkspace[workspaceId];
	if (existingDocument) return existingDocument;
	if (!state.workbenchFrame) throw new Error("The local workbench frame is not ready");
	const projection = emptyWorkspaceProjection(
		state.workbenchFrame,
		workspaceProjectionReference(workspaceId),
	);
	state.applyLocalLayoutState({
		frame: state.workbenchFrame,
		viewsByWorkspace: { ...state.workspaceViewsByWorkspace, [workspaceId]: projection.view },
		documentsByWorkspace: {
			...state.layoutDocumentsByWorkspace,
			[workspaceId]: projection.document,
		},
		attentionByWorkspace: {
			...state.layoutAttentionByWorkspace,
			[workspaceId]: projection.attention,
		},
		preferences: state.localLayoutPreferences,
	});
	const installed = useAppStore.getState().layoutDocumentsByWorkspace[workspaceId];
	if (!installed) throw new Error("The workspace layout could not be initialized");
	return installed;
}

export function ensureWorkspaceLayoutState(workspaceId: string): Promise<WorkspaceLayoutDocument> {
	const existing = workspaceInitializations.get(workspaceId);
	if (existing) return existing;
	const request = (async () => {
		if (useAppStore.getState().removedWorkspaceIds[workspaceId]) {
			throw new Error("Workspace has been removed");
		}
		await initializeLocalLayoutState();
		return installWorkspaceView(workspaceId);
	})().finally(() => {
		if (workspaceInitializations.get(workspaceId) === request) {
			workspaceInitializations.delete(workspaceId);
		}
	});
	workspaceInitializations.set(workspaceId, request);
	return request;
}

function withoutLayoutView(preferences: LocalLayoutPreferences): LocalLayoutPreferences {
	const { layoutView: _left, ...rest } = preferences;
	return rest;
}

function raisedLimits(
	preferences: LocalLayoutPreferences,
	sideGroups: number,
	bottomGroups: number,
): LocalLayoutPreferences {
	return {
		...preferences,
		maxSideGroups: Math.max(preferences.maxSideGroups, sideGroups),
		maxBottomGroups: Math.max(preferences.maxBottomGroups, bottomGroups),
	};
}

/** Installs a whole-frame result: every view's document and its attention, `selected` filling in groups it lacks. */
function installFrame(
	next: { frame: WorkbenchFrame; viewsByWorkspace: Record<string, WorkspaceViewState> },
	preferences: LocalLayoutPreferences,
	selected: Readonly<Record<string, string>> = {},
): void {
	const state = useAppStore.getState();
	const documentsByWorkspace = documentsForViews(next.frame, next.viewsByWorkspace);
	const attentionByWorkspace: Record<string, LayoutAttention> = {};
	for (const [workspaceId, document] of Object.entries(documentsByWorkspace)) {
		const previous = state.layoutAttentionByWorkspace[workspaceId];
		attentionByWorkspace[workspaceId] = reconcileAttention(
			document,
			previous
				? { ...previous, selectedByGroup: { ...selected, ...previous.selectedByGroup } }
				: undefined,
			state.layoutDocumentsByWorkspace[workspaceId],
		);
	}
	state.applyLocalLayoutState(
		{
			frame: next.frame,
			viewsByWorkspace: next.viewsByWorkspace,
			documentsByWorkspace,
			attentionByWorkspace,
			preferences,
		},
		true,
	);
}

export function applyLayoutPresetLocally(preset: LayoutPreset): void {
	const state = useAppStore.getState();
	if (!state.workbenchFrame) throw new Error("The local workbench frame is not ready");
	const next = applyWorkbenchPreset(
		{ frame: state.workbenchFrame, viewsByWorkspace: state.workspaceViewsByWorkspace },
		preset,
	);
	installFrame(
		next,
		raisedLimits(
			withoutLayoutView(state.localLayoutPreferences),
			minimumSideGroupLimit(preset),
			minimumBottomGroupLimit(preset),
		),
	);
}

function validatedFrame(next: NormalizedLayoutState): NormalizedLayoutState {
	for (const view of Object.values(next.viewsByWorkspace)) {
		const errors = validateLayoutDocument(projectWorkspaceLayout(next.frame, view), 32, 32);
		if (errors.length > 0) throw new Error(errors.join(" "));
	}
	if (Object.keys(next.viewsByWorkspace).length === 0) {
		const errors = validateLayoutDocument(emptyWorkspaceProjection(next.frame).document, 32, 32);
		if (errors.length > 0) throw new Error(errors.join(" "));
	}
	return next;
}

function currentFrameState(): NormalizedLayoutState {
	const state = useAppStore.getState();
	if (!state.workbenchFrame) throw new Error("The local workbench frame is not ready");
	return { frame: state.workbenchFrame, viewsByWorkspace: state.workspaceViewsByWorkspace };
}

function restoredFrame(view: LocalLayoutView): NormalizedLayoutState {
	return validatedFrame(
		restoreWorkbenchSides(currentFrameState(), view.restore, view.restoreTargets),
	);
}

/** The extension view this window is in, or `null`. */
export function currentLayoutView(): LocalLayoutView | null {
	return useAppStore.getState().localLayoutPreferences.layoutView ?? null;
}

/**
 * Enters view `id`: captures the frame's sides, bottom, restore targets and the tool each of their groups
 * shows into this window's preferences, then arranges the view (`arrangeWorkbenchView`) as one frame
 * commit. Another view is left first; the same one is a no-op — unless it was `migrated` from Board mode,
 * whose sides are restored first and the view arranged over them.
 */
export function enterLayoutViewLocally(id: string, arrangement: WorkbenchViewArrangement): void {
	const active = currentLayoutView();
	if (active?.id === id && !active.migrated) return;
	const state = useAppStore.getState();
	const base = active ? restoredFrame(active) : currentFrameState();
	const captured = captureWorkbenchSides(base.frame);
	const capturedGroupIds = new Set(
		[...base.frame.left.groups, ...base.frame.right.groups, ...base.frame.bottom.groups].map(
			(group) => group.id,
		),
	);
	const attention = state.activeWorkspaceId
		? state.layoutAttentionByWorkspace[state.activeWorkspaceId]
		: undefined;
	const selected = active
		? active.selected
		: Object.fromEntries(
				Object.entries(attention?.selectedByGroup ?? {}).filter(([groupId]) =>
					capturedGroupIds.has(groupId),
				),
			);
	const next = validatedFrame(arrangeWorkbenchView(base, arrangement));
	installFrame(
		next,
		{
			...withoutLayoutView(state.localLayoutPreferences),
			layoutView: {
				id,
				restore: captured,
				restoreTargets: { ...base.frame.toolRestoreTargets },
				selected,
			},
		},
		active ? active.selected : {},
	);
}

/** Leaves the view: the captured sides and bottom come back by group id, with the tools they showed. */
export function exitLayoutViewLocally(): void {
	const active = currentLayoutView();
	if (!active) return;
	const state = useAppStore.getState();
	installFrame(
		restoredFrame(active),
		withoutLayoutView(state.localLayoutPreferences),
		active.selected,
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

export function applyLayoutAttention(workspaceId: string, next: LayoutAttention): void {
	const state = useAppStore.getState();
	if (state.removedWorkspaceIds[workspaceId]) return;
	const document = state.layoutDocumentsByWorkspace[workspaceId];
	const normalized = document ? reconcileAttention(document, next, document) : next;
	if (sameLayoutAttention(state.layoutAttentionByWorkspace[workspaceId], normalized)) return;
	const groups = document
		? changedToolSelections(state.layoutAttentionByWorkspace[workspaceId], normalized, document)
		: new Set<string>();
	if (!document || groups.size === 0 || !state.workbenchFrame) {
		state.setLayoutAttention(workspaceId, normalized);
		return;
	}
	const attentionByWorkspace = {
		...state.layoutAttentionByWorkspace,
		[workspaceId]: normalized,
	};
	for (const [id, attention] of Object.entries(state.layoutAttentionByWorkspace)) {
		if (id === workspaceId || state.removedWorkspaceIds[id]) continue;
		const otherDocument = state.layoutDocumentsByWorkspace[id];
		if (!otherDocument) continue;
		attentionByWorkspace[id] = adoptToolSelections(
			attention,
			otherDocument,
			normalized,
			document,
			groups,
		);
	}
	state.applyLocalLayoutState({
		frame: state.workbenchFrame,
		viewsByWorkspace: state.workspaceViewsByWorkspace,
		documentsByWorkspace: state.layoutDocumentsByWorkspace,
		attentionByWorkspace,
		preferences: state.localLayoutPreferences,
	});
}

export interface LayoutCommitOptions {
	baseDocument?: WorkspaceLayoutDocument;
	attention?: LayoutAttention;
}

export async function commitWorkspaceLayout(
	workspaceId: string,
	document: WorkspaceLayoutDocument,
	options: LayoutCommitOptions = {},
): Promise<WorkspaceLayoutDocument> {
	const { baseDocument } = options;
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
			id === workspaceId
				? (options.attention ?? state.layoutAttentionByWorkspace[id])
				: state.layoutAttentionByWorkspace[id],
			id === workspaceId && options.attention
				? effectiveDocument
				: state.layoutDocumentsByWorkspace[id],
		);
	}
	const committingAttention = attentionByWorkspace[workspaceId];
	const committingDocument = documentsByWorkspace[workspaceId];
	if (!committingAttention || !committingDocument)
		throw new Error("The committed workspace projection is missing");
	const toolChanges = changedToolSelections(
		state.layoutAttentionByWorkspace[workspaceId],
		committingAttention,
		committingDocument,
	);
	if (frameChanged || toolChanges.size > 0) {
		if (committingAttention && committingDocument) {
			for (const [id, attention] of Object.entries(attentionByWorkspace)) {
				if (id === workspaceId) continue;
				const otherDocument = documentsByWorkspace[id];
				if (!otherDocument || state.removedWorkspaceIds[id]) continue;
				attentionByWorkspace[id] = adoptToolSelections(
					attention,
					otherDocument,
					committingAttention,
					committingDocument,
					frameChanged ? undefined : toolChanges,
				);
			}
		}
	}
	state.applyLocalLayoutState(
		{
			frame,
			viewsByWorkspace: projected.viewsByWorkspace,
			documentsByWorkspace,
			attentionByWorkspace,
			preferences: state.localLayoutPreferences,
		},
		frameChanged && !sameWorkbenchFrameShape(frame, state.workbenchFrame),
	);
	return useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] ?? document;
}

export function useLocalLayoutState(): void {
	useEffect(() => {
		void initializeLocalLayoutState().catch((error) => {
			toast.error(errorText(error), t("workbench.layoutState.loadFailed"));
		});
	}, []);
}

export function useWorkspaceLayoutState(workspaceId: string): void {
	useLayoutEffect(() => {
		const report = (error: unknown) => {
			if (!useAppStore.getState().removedWorkspaceIds[workspaceId]) {
				toast.error(errorText(error), t("workbench.layoutState.loadFailed"));
			}
		};
		if (useAppStore.getState().layoutStateReady) {
			try {
				installWorkspaceView(workspaceId);
			} catch (error) {
				report(error);
			}
			return;
		}
		void ensureWorkspaceLayoutState(workspaceId).catch(report);
	}, [workspaceId]);
}

export function setLayoutStateStorageForTests(
	storage: StoragePair | null,
	endpoint: string | null = null,
): void {
	storageOverride = storage;
	endpointOverride = endpoint;
	stablePreferenceOverride = null;
}

export function setLayoutStateStablePreferencesForTests(
	preferences: StablePreferenceAdapter | null,
): void {
	stablePreferenceOverride = preferences;
}

export function resetLayoutStateForTests(): void {
	workspaceInitializations.clear();
	stopPersistence?.();
	stopPersistence = null;
	releaseSurfaceLease?.();
	releaseSurfaceLease = null;
	initialization = null;
	persistenceKey = null;
	activeStablePreferences = null;
	storageOverride = null;
	endpointOverride = null;
	stablePreferenceOverride = undefined;
}
