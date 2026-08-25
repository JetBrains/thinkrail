import { posix } from "node:path";
import type {
	LayoutChangedPayload,
	LayoutPreset,
	LayoutReplaceParams,
	LayoutReplaceResult,
	LayoutSettings,
	LayoutToolId,
	WorkspaceLayoutDocument,
	WorkspaceLayoutSnapshot,
} from "@thinkrail/contracts";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import {
	loadWorkspaceLayout,
	loadWorkspaceLayoutBackup,
	removeWorkspaceLayout as removePersistedWorkspaceLayout,
	saveWorkspaceLayout,
} from "../persistence";

const MAX_LAYOUT_BYTES = 512 * 1024;
const MAX_CENTER_GROUPS = 4;
const MAX_DEPTH = 8;
const MAX_TABS = 256;
const MAX_SIDE_GROUPS_SAFETY = 32;
const MAX_BOTTOM_HEIGHT = 0.7;
const MIGRATED_LAYOUT_REVISION_FLOOR = 2;
const DEFAULT_BOTTOM = {
	visible: false,
	height: 0.3,
	alignment: "center",
	groups: [],
} as const;
const MAX_CUSTOM_PRESETS = 32;
const MAX_NAME_LENGTH = 200;
const MAX_TAB_NAME_LENGTH = 1000;
const MAX_TAB_ID_LENGTH = 5000;

const TOOL_IDS = new Set<LayoutToolId>(["projects", "specs", "files", "changes", "review"]);

type LayoutPublisher = (payload: LayoutChangedPayload) => void;
let publishLayout: LayoutPublisher | null = null;
const cache = new Map<string, WorkspaceLayoutSnapshot | null>();
const queues = new Map<string, Promise<void>>();
const removalEpochs = new Map<string, number>();
const futureProtected = new Set<string>();

export function setLayoutPublisher(publisher: LayoutPublisher | null): void {
	publishLayout = publisher;
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

type LayoutGroupLimits = Pick<LayoutSettings, "maxSideGroups" | "maxBottomGroups">;

function migrateRestoreTargets(value: unknown): unknown {
	const targets = record(value);
	if (!targets) return value;
	return Object.fromEntries(
		Object.entries(targets).map(([tool, raw]) => {
			const target = record(raw);
			if (!target || !("side" in target) || "region" in target) return [tool, raw];
			const { side, ...rest } = target;
			return [tool, { ...rest, region: side }];
		}),
	);
}

function migrateWorkspaceDocument(value: unknown): unknown {
	const document = record(value);
	if (document?.version !== 1) return value;
	return {
		...document,
		version: 2,
		bottom: structuredClone(DEFAULT_BOTTOM),
		toolRestoreTargets: migrateRestoreTargets(document.toolRestoreTargets),
	};
}

function migrateStoredPreset(value: unknown): unknown {
	const preset = record(value);
	if (!preset || preset.bottom !== undefined) return value;
	return { ...preset, bottom: structuredClone(DEFAULT_BOTTOM) };
}

function nonEmptyString(value: unknown, max = MAX_NAME_LENGTH): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
	const known = new Set(allowed);
	return Object.keys(value).filter((key) => !known.has(key));
}

function validateKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
	state: ValidationState,
): void {
	const extras = unknownKeys(value, allowed);
	if (extras.length > 0) state.errors.push(`${label} has unknown field: ${extras[0]}`);
}

function assertKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	const extras = unknownKeys(value, allowed);
	if (extras.length > 0) throw new Error(`${label} has unknown field: ${extras[0]}`);
}

function normalizedWidth(value: unknown): value is number {
	return positive(value) && value < 1;
}

function exceedsLayoutBudget(value: unknown): boolean {
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined || Buffer.byteLength(serialized) > MAX_LAYOUT_BYTES;
	} catch {
		return true;
	}
}

function canonicalWorkspacePath(value: unknown): value is string {
	return (
		nonEmptyString(value, 4096) &&
		!value.includes("\0") &&
		!value.includes("\\") &&
		!posix.isAbsolute(value) &&
		!/^[A-Za-z]:\//.test(value) &&
		value !== "." &&
		value !== ".." &&
		!value.startsWith("../") &&
		!value.endsWith("/") &&
		posix.normalize(value) === value
	);
}

function validScope(value: unknown): boolean {
	const scope = record(value);
	if (!scope || typeof scope.kind !== "string") return false;
	if (scope.kind === "branch" || scope.kind === "uncommitted") {
		return unknownKeys(scope, ["kind"]).length === 0;
	}
	if (scope.kind === "commit") {
		return nonEmptyString(scope.sha, 200) && unknownKeys(scope, ["kind", "sha"]).length === 0;
	}
	if (scope.kind === "pinned") {
		return (
			nonEmptyString(scope.baseRef, 500) && unknownKeys(scope, ["kind", "baseRef"]).length === 0
		);
	}
	return false;
}

interface ValidationState {
	errors: string[];
	ids: Set<string>;
	tabIds: Set<string>;
	resourceKeys: Set<string>;
	toolIds: Set<string>;
	centerGroups: number;
	emptyCenterGroups: number;
	tabs: number;
}

function addId(state: ValidationState, value: unknown, label: string): value is string {
	if (!nonEmptyString(value, 200)) {
		state.errors.push(`${label} has an invalid id`);
		return false;
	}
	if (state.ids.has(value)) state.errors.push(`Duplicate layout id: ${value}`);
	state.ids.add(value);
	return true;
}

function addResourceKey(state: ValidationState, key: string, label: string): void {
	if (state.resourceKeys.has(key)) state.errors.push(`Duplicate canonical resource: ${label}`);
	state.resourceKeys.add(key);
}

function scopeResourceKey(value: unknown): string | null {
	const scope = record(value);
	if (!scope || typeof scope.kind !== "string") return null;
	if (scope.kind === "branch" || scope.kind === "uncommitted") return scope.kind;
	if (scope.kind === "commit" && typeof scope.sha === "string") return `commit:${scope.sha}`;
	if (scope.kind === "pinned" && typeof scope.baseRef === "string") {
		return `pinned:${scope.baseRef}`;
	}
	return null;
}

function validateTab(value: unknown, area: "center" | "side", state: ValidationState): void {
	const tab = record(value);
	if (!tab || !nonEmptyString(tab.kind, 40) || !nonEmptyString(tab.id, MAX_TAB_ID_LENGTH)) {
		state.errors.push("Malformed layout tab");
		return;
	}
	state.tabs += 1;
	if (state.tabIds.has(tab.id)) state.errors.push(`Duplicate tab placement: ${tab.id}`);
	state.tabIds.add(tab.id);
	if (!nonEmptyString(tab.name, MAX_TAB_NAME_LENGTH)) {
		state.errors.push(`Invalid tab name: ${tab.id}`);
	}
	switch (tab.kind) {
		case "file":
			validateKeys(tab, ["kind", "id", "name", "path"], `File tab ${tab.id}`, state);
			if (area !== "center" || !canonicalWorkspacePath(tab.path)) {
				state.errors.push(`Invalid file tab: ${tab.id}`);
			} else {
				addResourceKey(state, `file:${tab.path}`, `file ${tab.path}`);
			}
			return;
		case "diff": {
			validateKeys(tab, ["kind", "id", "name", "path", "scope"], `Diff tab ${tab.id}`, state);
			const scopeKey = scopeResourceKey(tab.scope);
			if (
				area !== "center" ||
				!canonicalWorkspacePath(tab.path) ||
				!validScope(tab.scope) ||
				!scopeKey
			) {
				state.errors.push(`Invalid diff tab: ${tab.id}`);
			} else {
				addResourceKey(
					state,
					JSON.stringify(["diff", tab.path, scopeKey]),
					`diff ${tab.path} (${scopeKey})`,
				);
			}
			return;
		}
		case "chat":
			validateKeys(tab, ["kind", "id", "name", "sessionId"], `Chat tab ${tab.id}`, state);
			if (area !== "center" || !nonEmptyString(tab.sessionId, 500)) {
				state.errors.push(`Invalid chat tab: ${tab.id}`);
			} else {
				addResourceKey(state, `chat:${tab.sessionId}`, `chat ${tab.sessionId}`);
			}
			return;
		case "document":
			validateKeys(
				tab,
				["kind", "id", "name", "documentKind", "sourceId", "docPath"],
				`Virtual document ${tab.id}`,
				state,
			);
			if (
				area !== "center" ||
				tab.documentKind !== "todo-plan" ||
				!nonEmptyString(tab.sourceId, 500) ||
				!canonicalWorkspacePath(tab.docPath)
			) {
				state.errors.push(`Invalid virtual document: ${tab.id}`);
			} else {
				addResourceKey(
					state,
					`document:${tab.documentKind}:${tab.sourceId}`,
					`${tab.documentKind} document ${tab.sourceId}`,
				);
			}
			return;
		case "terminal":
			validateKeys(tab, ["kind", "id", "name", "tabKey"], `Terminal tab ${tab.id}`, state);
			if (!nonEmptyString(tab.tabKey, 500)) {
				state.errors.push(`Invalid terminal tab: ${tab.id}`);
			} else {
				addResourceKey(state, `terminal:${tab.tabKey}`, `terminal ${tab.tabKey}`);
			}
			return;
		case "tool": {
			validateKeys(tab, ["kind", "id", "name", "tool"], `Tool tab ${tab.id}`, state);
			if (
				area !== "side" ||
				typeof tab.tool !== "string" ||
				!TOOL_IDS.has(tab.tool as LayoutToolId)
			) {
				state.errors.push(`Invalid side tool: ${tab.id}`);
				return;
			}
			if (state.toolIds.has(tab.tool)) state.errors.push(`Duplicate singleton tool: ${tab.tool}`);
			state.toolIds.add(tab.tool);
			return;
		}
		default:
			state.errors.push(`Unknown tab kind: ${tab.kind}`);
	}
}

function validateCenter(value: unknown, depth: number, state: ValidationState): void {
	const node = record(value);
	if (!node || !addId(state, node.id, "Center node") || typeof node.kind !== "string") {
		state.errors.push("Malformed center node");
		return;
	}
	if (depth > MAX_DEPTH) {
		state.errors.push("Center split tree is too deep");
		return;
	}
	if (node.kind === "group") {
		validateKeys(node, ["kind", "id", "tabs", "previewTabId"], `Center group ${node.id}`, state);
		state.centerGroups += 1;
		if (!Array.isArray(node.tabs)) {
			state.errors.push(`Center group ${node.id} has no tab list`);
			return;
		}
		if (node.tabs.length === 0) state.emptyCenterGroups += 1;
		for (const tab of node.tabs) validateTab(tab, "center", state);
		if (node.previewTabId !== undefined) {
			const preview = node.tabs.find((tab) => record(tab)?.id === node.previewTabId);
			const previewKind = record(preview)?.kind;
			if (
				!nonEmptyString(node.previewTabId, MAX_TAB_ID_LENGTH) ||
				!preview ||
				(previewKind !== "file" && previewKind !== "diff")
			) {
				state.errors.push(`Center group ${node.id} has an invalid preview`);
			}
		}
		return;
	}
	if (node.kind !== "split") {
		state.errors.push(`Unknown center node kind: ${node.kind}`);
		return;
	}
	validateKeys(
		node,
		["kind", "id", "direction", "weights", "children"],
		`Center split ${node.id}`,
		state,
	);
	if (node.direction !== "horizontal" && node.direction !== "vertical") {
		state.errors.push(`Invalid split direction: ${node.id}`);
	}
	if (
		!Array.isArray(node.weights) ||
		node.weights.length !== 2 ||
		!positive(node.weights[0]) ||
		!positive(node.weights[1]) ||
		Math.abs(node.weights[0] + node.weights[1] - 1) > 1e-6
	) {
		state.errors.push(`Invalid split weights: ${node.id}`);
	}
	if (!Array.isArray(node.children) || node.children.length !== 2) {
		state.errors.push(`Split ${node.id} must have two children`);
		return;
	}
	validateCenter(node.children[0], depth + 1, state);
	validateCenter(node.children[1], depth + 1, state);
}

function validateSide(
	value: unknown,
	side: "left" | "right",
	currentCount: number,
	configuredLimit: number,
	state: ValidationState,
): void {
	const region = record(value);
	if (
		!region ||
		typeof region.visible !== "boolean" ||
		!normalizedWidth(region.width) ||
		!Array.isArray(region.groups)
	) {
		state.errors.push(`Malformed ${side} side`);
		return;
	}
	validateKeys(region, ["visible", "width", "groups"], `${side} side`, state);
	const allowed = Math.max(configuredLimit, currentCount);
	if (region.groups.length > allowed) state.errors.push(`${side} side exceeds its group limit`);
	if (region.groups.length > MAX_SIDE_GROUPS_SAFETY)
		state.errors.push(`${side} side exceeds the safety limit`);
	if (region.visible && region.groups.length === 0)
		state.errors.push(`${side} side cannot be visible while empty`);
	let weightTotal = 0;
	for (const valueGroup of region.groups) {
		const group = record(valueGroup);
		if (!group || !addId(state, group.id, `${side} group`)) continue;
		validateKeys(group, ["id", "weight", "folded", "tabs"], `${side} group ${group.id}`, state);
		if (
			!positive(group.weight) ||
			typeof group.folded !== "boolean" ||
			!Array.isArray(group.tabs)
		) {
			state.errors.push(`Malformed side group: ${group.id}`);
			continue;
		}
		if (positive(group.weight)) weightTotal += group.weight;
		if (group.tabs.length === 0) state.errors.push(`Empty side group: ${group.id}`);
		for (const tab of group.tabs) validateTab(tab, "side", state);
	}
	if (region.groups.length > 0 && Math.abs(weightTotal - 1) > 1e-6) {
		state.errors.push(`${side} side group weights are not normalized`);
	}
}

function validateBottom(
	value: unknown,
	currentCount: number,
	configuredLimit: number,
	state: ValidationState,
): void {
	const region = record(value);
	if (
		!region ||
		typeof region.visible !== "boolean" ||
		!positive(region.height) ||
		(region.alignment !== "center" &&
			region.alignment !== "center-left" &&
			region.alignment !== "center-right" &&
			region.alignment !== "full") ||
		!Array.isArray(region.groups)
	) {
		state.errors.push("Malformed bottom region");
		return;
	}
	validateKeys(region, ["visible", "height", "alignment", "groups"], "Bottom region", state);
	if (region.visible && region.groups.length === 0) {
		state.errors.push("Visible bottom region requires a group");
	}
	if (Number(region.height) > MAX_BOTTOM_HEIGHT) state.errors.push("Invalid bottom height");
	const allowed = Math.max(configuredLimit, currentCount);
	if (region.groups.length > allowed) state.errors.push("bottom region exceeds its group limit");
	if (region.groups.length > MAX_SIDE_GROUPS_SAFETY) {
		state.errors.push("bottom region exceeds the safety limit");
	}
	let weightTotal = 0;
	for (const valueGroup of region.groups) {
		const group = record(valueGroup);
		if (!group || !addId(state, group.id, "Bottom group")) continue;
		validateKeys(group, ["id", "weight", "folded", "tabs"], `Bottom group ${group.id}`, state);
		if (
			!positive(group.weight) ||
			typeof group.folded !== "boolean" ||
			!Array.isArray(group.tabs)
		) {
			state.errors.push(`Malformed bottom group: ${group.id}`);
			continue;
		}
		weightTotal += Number(group.weight);
		for (const tab of group.tabs) validateTab(tab, "side", state);
	}
	if (region.groups.length > 0 && Math.abs(weightTotal - 1) > 1e-6) {
		state.errors.push("Bottom group weights are not normalized");
	}
}

function validateRestoreTargets(value: unknown, state: ValidationState): void {
	const targets = record(value);
	if (!targets) {
		state.errors.push("Malformed tool restore targets");
		return;
	}
	for (const [tool, raw] of Object.entries(targets)) {
		if (!TOOL_IDS.has(tool as LayoutToolId)) {
			state.errors.push(`Unknown restore tool: ${tool}`);
			continue;
		}
		const target = record(raw);
		if (target) {
			validateKeys(target, ["region", "groupId", "index"], `Restore target ${tool}`, state);
		}
		if (
			!target ||
			(target.region !== "left" && target.region !== "right" && target.region !== "bottom") ||
			!Number.isSafeInteger(target.index) ||
			Number(target.index) < 0 ||
			Number(target.index) > MAX_TABS ||
			(target.groupId !== undefined && !nonEmptyString(target.groupId, 200))
		) {
			state.errors.push(`Invalid restore target: ${tool}`);
		}
	}
}

export function validateWorkspaceLayout(
	value: unknown,
	limits: LayoutGroupLimits,
	current?: WorkspaceLayoutDocument,
): WorkspaceLayoutDocument {
	if (exceedsLayoutBudget(value)) throw new Error("Layout snapshot is too large");
	const document = record(value);
	if (document?.version !== 2) throw new Error("Unsupported layout schema version");
	const state: ValidationState = {
		errors: [],
		ids: new Set(),
		tabIds: new Set(),
		resourceKeys: new Set(),
		toolIds: new Set(),
		centerGroups: 0,
		emptyCenterGroups: 0,
		tabs: 0,
	};
	validateKeys(
		document,
		["version", "center", "left", "right", "bottom", "toolRestoreTargets"],
		"Layout document",
		state,
	);
	validateCenter(document.center, 1, state);
	validateSide(
		document.left,
		"left",
		current?.left.groups.length ?? 0,
		limits.maxSideGroups,
		state,
	);
	validateSide(
		document.right,
		"right",
		current?.right.groups.length ?? 0,
		limits.maxSideGroups,
		state,
	);
	validateBottom(
		document.bottom,
		current?.bottom.groups.length ?? 0,
		limits.maxBottomGroups,
		state,
	);
	const left = record(document.left);
	const right = record(document.right);
	if (
		typeof left?.width === "number" &&
		typeof right?.width === "number" &&
		left.width + right.width >= 1
	) {
		state.errors.push("Side widths leave no center region");
	}
	validateRestoreTargets(document.toolRestoreTargets, state);
	if (state.centerGroups < 1 || state.centerGroups > MAX_CENTER_GROUPS) {
		state.errors.push(`Center must contain 1–${MAX_CENTER_GROUPS} groups`);
	}
	if (state.emptyCenterGroups > 1) state.errors.push("Only one empty center group may remain");
	if (state.tabs > MAX_TABS) state.errors.push("Layout contains too many tabs");
	if (state.errors.length > 0) throw new Error(state.errors[0]);
	return value as WorkspaceLayoutDocument;
}

function validatePresetCenter(value: unknown, depth: number, ids: Set<string>): number {
	const node = record(value);
	if (!node || !nonEmptyString(node.id, 200) || (node.kind !== "group" && node.kind !== "split")) {
		throw new Error("Malformed layout preset center");
	}
	if (ids.has(node.id)) throw new Error(`Duplicate preset id: ${node.id}`);
	ids.add(node.id);
	if (depth > MAX_DEPTH) throw new Error("Preset center is too deep");
	if (node.kind === "group") {
		assertKeys(node, ["kind", "id"], `Preset center group ${node.id}`);
		return 1;
	}
	assertKeys(
		node,
		["kind", "id", "direction", "weights", "children"],
		`Preset center split ${node.id}`,
	);
	if (
		(node.direction !== "horizontal" && node.direction !== "vertical") ||
		!Array.isArray(node.weights) ||
		node.weights.length !== 2 ||
		!positive(node.weights[0]) ||
		!positive(node.weights[1]) ||
		Math.abs(node.weights[0] + node.weights[1] - 1) > 1e-6 ||
		!Array.isArray(node.children) ||
		node.children.length !== 2
	) {
		throw new Error("Malformed layout preset split");
	}
	return (
		validatePresetCenter(node.children[0], depth + 1, ids) +
		validatePresetCenter(node.children[1], depth + 1, ids)
	);
}

export function validateLayoutPreset(value: unknown): LayoutPreset {
	if (exceedsLayoutBudget(value)) throw new Error("Layout preset is too large");
	const preset = record(value);
	if (!preset || !nonEmptyString(preset.id, 200) || !nonEmptyString(preset.name, MAX_NAME_LENGTH)) {
		throw new Error("Malformed layout preset");
	}
	assertKeys(preset, ["id", "name", "center", "left", "right", "bottom"], "Layout preset");
	const ids = new Set<string>();
	if (validatePresetCenter(preset.center, 1, ids) > MAX_CENTER_GROUPS) {
		throw new Error("Preset has too many center groups");
	}
	const tools = new Set<string>();
	for (const side of ["left", "right"] as const) {
		const region = record(preset[side]);
		if (
			!region ||
			typeof region.visible !== "boolean" ||
			!normalizedWidth(region.width) ||
			!Array.isArray(region.groups)
		) {
			throw new Error(`Malformed preset ${side} side`);
		}
		assertKeys(region, ["visible", "width", "groups"], `Preset ${side} side`);
		if (region.visible && region.groups.length === 0) {
			throw new Error(`Preset ${side} side cannot be visible while empty`);
		}
		if (region.groups.length > MAX_SIDE_GROUPS_SAFETY)
			throw new Error("Preset has too many side groups");
		let weightTotal = 0;
		for (const rawGroup of region.groups) {
			const group = record(rawGroup);
			if (
				!group ||
				!nonEmptyString(group.id, 200) ||
				!positive(group.weight) ||
				typeof group.folded !== "boolean" ||
				!Array.isArray(group.tools) ||
				group.tools.length === 0 ||
				!group.tools.every((tool) => typeof tool === "string" && TOOL_IDS.has(tool as LayoutToolId))
			) {
				throw new Error("Malformed preset side group");
			}
			assertKeys(group, ["id", "weight", "folded", "tools"], `Preset ${side} group`);
			weightTotal += group.weight;
			if (ids.has(group.id)) throw new Error(`Duplicate preset id: ${group.id}`);
			ids.add(group.id);
			for (const tool of group.tools) {
				if (tools.has(String(tool))) throw new Error(`Duplicate preset singleton tool: ${tool}`);
				tools.add(String(tool));
			}
		}
		if (region.groups.length > 0 && Math.abs(weightTotal - 1) > 1e-6) {
			throw new Error(`Preset ${side} side group weights are not normalized`);
		}
	}
	const bottom = record(preset.bottom);
	if (
		!bottom ||
		typeof bottom.visible !== "boolean" ||
		!positive(bottom.height) ||
		Number(bottom.height) > MAX_BOTTOM_HEIGHT ||
		(bottom.alignment !== "center" &&
			bottom.alignment !== "center-left" &&
			bottom.alignment !== "center-right" &&
			bottom.alignment !== "full") ||
		!Array.isArray(bottom.groups)
	) {
		throw new Error("Malformed preset bottom region");
	}
	assertKeys(bottom, ["visible", "height", "alignment", "groups"], "Preset bottom region");
	if (bottom.visible && bottom.groups.length === 0) {
		throw new Error("Preset bottom region cannot be visible without a group");
	}
	if (bottom.groups.length > MAX_SIDE_GROUPS_SAFETY) {
		throw new Error("Preset has too many bottom groups");
	}
	let bottomWeightTotal = 0;
	for (const rawGroup of bottom.groups) {
		const group = record(rawGroup);
		if (
			!group ||
			!nonEmptyString(group.id, 200) ||
			!positive(group.weight) ||
			typeof group.folded !== "boolean" ||
			!Array.isArray(group.tools) ||
			!group.tools.every((tool) => typeof tool === "string" && TOOL_IDS.has(tool as LayoutToolId))
		) {
			throw new Error("Malformed preset bottom group");
		}
		assertKeys(group, ["id", "weight", "folded", "tools"], "Preset bottom group");
		bottomWeightTotal += Number(group.weight);
		if (ids.has(group.id)) throw new Error(`Duplicate preset id: ${group.id}`);
		ids.add(group.id);
		for (const tool of group.tools) {
			if (tools.has(String(tool))) throw new Error(`Duplicate preset singleton tool: ${tool}`);
			tools.add(String(tool));
		}
	}
	if (bottom.groups.length > 0 && Math.abs(bottomWeightTotal - 1) > 1e-6) {
		throw new Error("Preset bottom group weights are not normalized");
	}
	const left = record(preset.left);
	const right = record(preset.right);
	if (
		typeof left?.width === "number" &&
		typeof right?.width === "number" &&
		left.width + right.width >= 1
	) {
		throw new Error("Preset side widths leave no center region");
	}
	return value as LayoutPreset;
}

export function normalizeStoredLayoutSettings(current: LayoutSettings): LayoutSettings {
	const customPresets: LayoutPreset[] = [];
	const seen = new Set<string>();
	const selectedWasCustom = current.customPresets.some(
		(candidate) => record(candidate)?.id === current.defaultPresetId,
	);
	let maxSideGroups = current.maxSideGroups;
	let maxBottomGroups = current.maxBottomGroups ?? DEFAULT_CONFIG.layout.maxBottomGroups;
	for (const candidate of current.customPresets.slice(0, MAX_CUSTOM_PRESETS)) {
		try {
			const preset = validateLayoutPreset(migrateStoredPreset(candidate));
			if (seen.has(preset.id)) continue;
			seen.add(preset.id);
			customPresets.push(preset);
			maxSideGroups = Math.max(
				maxSideGroups,
				preset.left.groups.length,
				preset.right.groups.length,
			);
			maxBottomGroups = Math.max(maxBottomGroups, preset.bottom.groups.length);
		} catch {}
	}
	const selectedCustomSurvived = customPresets.some(
		(preset) => preset.id === current.defaultPresetId,
	);
	const fellBackToDefault = selectedWasCustom && !selectedCustomSurvived;
	return {
		defaultPresetId: fellBackToDefault
			? DEFAULT_CONFIG.layout.defaultPresetId
			: current.defaultPresetId,
		customPresets,
		maxSideGroups: fellBackToDefault
			? Math.max(maxSideGroups, DEFAULT_CONFIG.layout.maxSideGroups)
			: maxSideGroups,
		maxBottomGroups: fellBackToDefault
			? Math.max(maxBottomGroups, DEFAULT_CONFIG.layout.maxBottomGroups)
			: maxBottomGroups,
	};
}

export function validateLayoutSettings(value: unknown): LayoutSettings {
	if (exceedsLayoutBudget(value)) throw new Error("Layout settings are too large");
	const settings = record(value);
	if (
		!settings ||
		!nonEmptyString(settings.defaultPresetId, 200) ||
		!Number.isInteger(settings.maxSideGroups) ||
		Number(settings.maxSideGroups) < 1 ||
		Number(settings.maxSideGroups) > MAX_SIDE_GROUPS_SAFETY ||
		!Number.isInteger(settings.maxBottomGroups) ||
		Number(settings.maxBottomGroups) < 1 ||
		Number(settings.maxBottomGroups) > MAX_SIDE_GROUPS_SAFETY ||
		!Array.isArray(settings.customPresets) ||
		settings.customPresets.length > MAX_CUSTOM_PRESETS
	) {
		throw new Error("Invalid layout settings");
	}
	assertKeys(
		settings,
		["defaultPresetId", "customPresets", "maxSideGroups", "maxBottomGroups"],
		"Layout settings",
	);
	for (const rawPreset of settings.customPresets) {
		const preset = validateLayoutPreset(rawPreset);
		if (
			preset.left.groups.length > Number(settings.maxSideGroups) ||
			preset.right.groups.length > Number(settings.maxSideGroups)
		) {
			throw new Error("Custom preset exceeds the configured side-group limit");
		}
		if (preset.bottom.groups.length > Number(settings.maxBottomGroups)) {
			throw new Error("Custom preset exceeds the configured bottom-group limit");
		}
	}
	const ids = settings.customPresets.map((preset) => preset.id);
	if (new Set(ids).size !== ids.length) throw new Error("Custom preset ids must be unique");
	return value as LayoutSettings;
}

function parseSnapshot(value: unknown, workspaceId: string): WorkspaceLayoutSnapshot | null {
	const snapshot = record(value);
	if (
		!snapshot ||
		unknownKeys(snapshot, ["workspaceId", "revision", "document"]).length > 0 ||
		snapshot.workspaceId !== workspaceId ||
		!Number.isSafeInteger(snapshot.revision) ||
		Number(snapshot.revision) < 0
	) {
		return null;
	}
	try {
		const migratedFromVersionOne = record(snapshot.document)?.version === 1;
		const document = validateWorkspaceLayout(migrateWorkspaceDocument(snapshot.document), {
			maxSideGroups: MAX_SIDE_GROUPS_SAFETY,
			maxBottomGroups: MAX_SIDE_GROUPS_SAFETY,
		});
		const revision = migratedFromVersionOne
			? Math.max(Number(snapshot.revision), MIGRATED_LAYOUT_REVISION_FLOOR)
			: Number(snapshot.revision);
		return { workspaceId, revision, document };
	} catch {
		return null;
	}
}

function hasFutureLayoutVersion(value: unknown): boolean {
	const snapshot = record(value);
	const document = record(snapshot?.document);
	return typeof document?.version === "number" && document.version > 2;
}

export function getWorkspaceLayout(workspaceId: string): WorkspaceLayoutSnapshot | null {
	if (cache.has(workspaceId)) return cache.get(workspaceId) ?? null;
	const primaryRaw = loadWorkspaceLayout(workspaceId);
	const primary = parseSnapshot(primaryRaw, workspaceId);
	if (primary) {
		futureProtected.delete(workspaceId);
		cache.set(workspaceId, primary);
		return primary;
	}
	const future = hasFutureLayoutVersion(primaryRaw);
	const backup = parseSnapshot(loadWorkspaceLayoutBackup(workspaceId), workspaceId);
	if (future) {
		futureProtected.add(workspaceId);
		if (!backup) throw new Error("Workspace layout was written by a newer host");
	} else {
		futureProtected.delete(workspaceId);
	}
	cache.set(workspaceId, backup);
	return backup;
}

export function replaceWorkspaceLayout(
	params: LayoutReplaceParams,
	limits: LayoutGroupLimits,
): Promise<LayoutReplaceResult> {
	if (!nonEmptyString(params.mutationId, 200))
		return Promise.reject(new Error("Invalid layout mutation id"));
	if (
		params.expectedRevision !== null &&
		(!Number.isSafeInteger(params.expectedRevision) || params.expectedRevision < 0)
	) {
		return Promise.reject(new Error("Invalid expected layout revision"));
	}
	const prior = queues.get(params.workspaceId) ?? Promise.resolve();
	const removalEpoch = removalEpochs.get(params.workspaceId) ?? 0;
	const operation = prior
		.catch(() => {})
		.then((): LayoutReplaceResult => {
			if ((removalEpochs.get(params.workspaceId) ?? 0) !== removalEpoch) {
				throw new Error("Workspace layout was removed before the write completed");
			}
			const current = getWorkspaceLayout(params.workspaceId);
			const revisionMatches =
				params.expectedRevision === null
					? current === null
					: current?.revision === params.expectedRevision;
			if (!revisionMatches) return { status: "conflict", current };
			if (futureProtected.has(params.workspaceId)) {
				throw new Error("Workspace layout is read-only because it was written by a newer host");
			}
			const document = validateWorkspaceLayout(params.document, limits, current?.document);
			if ((current?.revision ?? 0) >= Number.MAX_SAFE_INTEGER) {
				throw new Error("Workspace layout revision limit reached");
			}
			const snapshot: WorkspaceLayoutSnapshot = {
				workspaceId: params.workspaceId,
				revision: (current?.revision ?? 0) + 1,
				document,
			};
			saveWorkspaceLayout(snapshot, current);
			cache.set(params.workspaceId, snapshot);
			const payload: LayoutChangedPayload = { snapshot, mutationId: params.mutationId };
			publishLayout?.(payload);
			return { status: "accepted", payload };
		});
	const tail = operation.then(
		() => {},
		() => {},
	);
	queues.set(params.workspaceId, tail);
	void tail.finally(() => {
		if (queues.get(params.workspaceId) === tail) queues.delete(params.workspaceId);
	});
	return operation;
}

export function removeWorkspaceLayout(workspaceId: string): void {
	removalEpochs.set(workspaceId, (removalEpochs.get(workspaceId) ?? 0) + 1);
	cache.delete(workspaceId);
	queues.delete(workspaceId);
	futureProtected.delete(workspaceId);
	removePersistedWorkspaceLayout(workspaceId);
}

export function resetLayoutsForTests(): void {
	cache.clear();
	queues.clear();
	removalEpochs.clear();
	futureProtected.clear();
	publishLayout = null;
}
