import type { LayoutPreset, LayoutToolId } from "@thinkrail/contracts";

const MAX_PRESETS = 32;
const MAX_LAYOUT_BYTES = 512 * 1024;
const MAX_CENTER_GROUPS = 4;
const MAX_GROUPS = 32;
const MAX_DEPTH = 8;
const MAX_NAME_LENGTH = 200;
const MAX_BOTTOM_HEIGHT = 0.7;
const TOOL_IDS = new Set<LayoutToolId>(["projects", "specs", "files", "changes", "review"]);

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function nonEmptyString(value: unknown, max = MAX_NAME_LENGTH): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function assertKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	const known = new Set(allowed);
	const extra = Object.keys(value).find((key) => !known.has(key));
	if (extra) throw new Error(`${label} has unknown field: ${extra}`);
}

function exceedsBudget(value: unknown): boolean {
	try {
		return new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_LAYOUT_BYTES;
	} catch {
		return true;
	}
}

function validateCenter(value: unknown, depth: number, ids: Set<string>): number {
	const node = record(value);
	if (!node || !nonEmptyString(node.id) || (node.kind !== "group" && node.kind !== "split")) {
		throw new Error("Malformed layout preset center");
	}
	if (ids.has(node.id)) throw new Error(`Duplicate preset node id: ${node.id}`);
	ids.add(node.id);
	if (depth > MAX_DEPTH) throw new Error("Layout preset center is too deep");
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
		validateCenter(node.children[0], depth + 1, ids) +
		validateCenter(node.children[1], depth + 1, ids)
	);
}

function validateGroups(value: unknown, ids: Set<string>, tools: Set<string>, label: string): void {
	if (!Array.isArray(value) || value.length > MAX_GROUPS) {
		throw new Error(`Malformed preset ${label} groups`);
	}
	let total = 0;
	for (const candidate of value) {
		const group = record(candidate);
		if (
			!group ||
			!nonEmptyString(group.id) ||
			!positive(group.weight) ||
			typeof group.folded !== "boolean" ||
			!Array.isArray(group.tools) ||
			!group.tools.every((tool) => typeof tool === "string" && TOOL_IDS.has(tool as LayoutToolId))
		) {
			throw new Error(`Malformed preset ${label} group`);
		}
		assertKeys(group, ["id", "weight", "folded", "tools"], `Preset ${label} group`);
		if (ids.has(group.id)) throw new Error(`Duplicate preset node id: ${group.id}`);
		ids.add(group.id);
		total += group.weight;
		for (const tool of group.tools) {
			if (tools.has(String(tool))) throw new Error(`Duplicate preset singleton tool: ${tool}`);
			tools.add(String(tool));
		}
	}
	if (value.length > 0 && Math.abs(total - 1) > 1e-6) {
		throw new Error(`Preset ${label} group weights are not normalized`);
	}
}

export function validateLayoutPreset(value: unknown): LayoutPreset {
	if (exceedsBudget(value)) throw new Error("Layout preset is too large");
	const preset = record(value);
	if (!preset || !nonEmptyString(preset.id) || !nonEmptyString(preset.name)) {
		throw new Error("Malformed layout preset");
	}
	assertKeys(preset, ["id", "name", "center", "left", "right", "bottom"], "Layout preset");
	const ids = new Set<string>();
	if (validateCenter(preset.center, 1, ids) > MAX_CENTER_GROUPS) {
		throw new Error("Layout preset has too many center groups");
	}
	const tools = new Set<string>();
	for (const side of ["left", "right"] as const) {
		const region = record(preset[side]);
		if (
			!region ||
			typeof region.visible !== "boolean" ||
			!positive(region.width) ||
			Number(region.width) >= 1 ||
			!Array.isArray(region.groups)
		) {
			throw new Error(`Malformed preset ${side} side`);
		}
		assertKeys(region, ["visible", "width", "groups"], `Preset ${side} side`);
		if (region.visible && region.groups.length === 0) {
			throw new Error(`Preset ${side} side cannot be visible while empty`);
		}
		validateGroups(region.groups, ids, tools, `${side} side`);
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
	validateGroups(bottom.groups, ids, tools, "bottom");
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

export function validateCustomLayoutPresets(value: unknown): LayoutPreset[] {
	if (exceedsBudget(value) || !Array.isArray(value) || value.length > MAX_PRESETS) {
		throw new Error("Invalid custom layout presets");
	}
	const presets = value.map(validateLayoutPreset);
	if (new Set(presets.map((preset) => preset.id)).size !== presets.length) {
		throw new Error("Custom layout preset ids must be unique");
	}
	return presets;
}

export function normalizeStoredCustomLayoutPresets(value: unknown): LayoutPreset[] {
	if (!Array.isArray(value)) return [];
	const presets: LayoutPreset[] = [];
	const ids = new Set<string>();
	for (const candidate of value.slice(0, MAX_PRESETS)) {
		try {
			const preset = validateLayoutPreset(candidate);
			if (ids.has(preset.id)) continue;
			ids.add(preset.id);
			presets.push(preset);
		} catch {}
	}
	return presets;
}
