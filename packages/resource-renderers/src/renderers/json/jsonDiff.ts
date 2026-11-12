import { create, type Delta } from "jsondiffpatch";

export type JsonDiffKind = "added" | "removed" | "changed" | "moved";

export type JsonPathSegment = string | number;

export interface JsonDiffMark {
	kind: JsonDiffKind;
	pointer: string;
	oldPointer?: string;
	renderedParent?: string;
	path?: readonly JsonPathSegment[];
	oldValue?: unknown;
	newValue?: unknown;
}

export interface JsonNestedChange {
	mark: JsonDiffMark;
	path: readonly JsonPathSegment[];
	order: number;
}

export interface JsonNestedChanges {
	total: number;
	first: readonly JsonNestedChange[];
}

export interface JsonDiffClassification {
	delta: Delta;
	current: ReadonlyMap<string, JsonDiffMark>;
	removed: ReadonlyMap<string, JsonDiffMark>;
}

function stableValue(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableValue(Reflect.get(value, key))}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function stableObjectHash(item: object): string {
	for (const key of ["id", "key", "name"]) {
		const value = Reflect.get(item, key);
		if (typeof value === "string" || typeof value === "number") return `${key}:${value}`;
	}
	return stableValue(item);
}

const patcher = create({
	objectHash: stableObjectHash,
	arrays: { detectMove: true, includeValueOnMove: true },
});

function escapePointerSegment(segment: string): string {
	return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(pointer: string, segment: string | number): string {
	return `${pointer}/${escapePointerSegment(String(segment))}`;
}

function deltaRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function removedDelta(value: unknown): boolean {
	return Array.isArray(value) && value[2] === 0;
}

function arrayIndexMap(
	record: Record<string, unknown>,
	originalLength: number,
	modifiedLength: number,
): ReadonlyMap<number, number> | null {
	const result = new Map<number, number>();
	const removed = new Set<number>();
	const occupied = new Set<number>();
	for (const [key, part] of Object.entries(record)) {
		if (key === "_t") continue;
		if (/^_\d+$/.test(key)) {
			const oldIndex = Number(key.slice(1));
			if (!Array.isArray(part) || oldIndex >= originalLength) return null;
			if (part[2] === 0) {
				removed.add(oldIndex);
				continue;
			}
			if (part[2] === 3 && Number.isInteger(part[1])) {
				const destination = part[1] as number;
				if (destination < 0 || destination >= modifiedLength || occupied.has(destination)) {
					return null;
				}
				result.set(oldIndex, destination);
				occupied.add(destination);
			}
			continue;
		}
		if (/^\d+$/.test(key) && Array.isArray(part) && part.length === 1) {
			const insertedIndex = Number(key);
			if (insertedIndex >= modifiedLength || occupied.has(insertedIndex)) return null;
			occupied.add(insertedIndex);
		}
	}
	const remainingOriginal = Array.from({ length: originalLength }, (_value, index) => index).filter(
		(index) => !removed.has(index) && !result.has(index),
	);
	const remainingModified = Array.from({ length: modifiedLength }, (_value, index) => index).filter(
		(index) => !occupied.has(index),
	);
	if (remainingOriginal.length !== remainingModified.length) return null;
	for (let index = 0; index < remainingOriginal.length; index += 1) {
		const oldIndex = remainingOriginal[index];
		const newIndex = remainingModified[index];
		if (oldIndex !== undefined && newIndex !== undefined) result.set(oldIndex, newIndex);
	}
	return result;
}

export function classifyJsonDelta(
	delta: Delta,
	original: unknown,
	modified: unknown,
): Omit<JsonDiffClassification, "delta"> {
	const current = new Map<string, JsonDiffMark>();
	const removed = new Map<string, JsonDiffMark>();
	const visit = (
		part: Delta,
		oldValue: unknown,
		newValue: unknown,
		pointer: string,
		oldPointer: string,
		path: readonly JsonPathSegment[],
	) => {
		if (part === undefined) return;
		const leaf = (mark: JsonDiffMark) => current.set(pointer, { ...mark, path });
		if (Array.isArray(part)) {
			const tuple = part as unknown[];
			if (tuple.length === 1) {
				leaf({ kind: "added", pointer, newValue: tuple[0] });
				return;
			}
			if (tuple.length === 2) {
				leaf({ kind: "changed", pointer, oldValue: tuple[0], newValue: tuple[1] });
				return;
			}
			if (tuple[2] === 2) leaf({ kind: "changed", pointer, oldValue: tuple[0] });
			return;
		}
		const record = part as { [key: string]: Delta | "a" };
		const removal = (key: JsonPathSegment, value: unknown) => {
			const removedPointer = childPointer(oldPointer, key);
			removed.set(removedPointer, {
				kind: "removed",
				pointer: removedPointer,
				renderedParent: pointer,
				path: [...path, key],
				oldValue: value,
			});
		};
		if (record._t === "a") {
			const oldItems = Array.isArray(oldValue) ? oldValue : [];
			const newItems = Array.isArray(newValue) ? newValue : [];
			const newToOld = new Map<number, number>();
			for (const [from, to] of arrayIndexMap(record, oldItems.length, newItems.length) ?? []) {
				newToOld.set(to, from);
			}
			for (const [key, child] of Object.entries(record)) {
				if (key === "_t" || child === undefined || child === "a") continue;
				if (key.startsWith("_")) {
					const oldIndex = Number(key.slice(1));
					if (!Array.isArray(child)) continue;
					if (child[2] === 0) removal(oldIndex, child[0]);
					if (child[2] === 3 && typeof child[1] === "number") {
						const nextPointer = childPointer(pointer, child[1]);
						current.set(nextPointer, {
							kind: "moved",
							pointer: nextPointer,
							oldPointer: childPointer(oldPointer, oldIndex),
							path: [...path, child[1]],
							oldValue: child[0],
						});
					}
					continue;
				}
				const index = Number(key);
				const oldIndex = newToOld.get(index) ?? index;
				visit(
					child,
					oldItems[oldIndex],
					newItems[index],
					childPointer(pointer, index),
					childPointer(oldPointer, oldIndex),
					[...path, index],
				);
			}
			return;
		}
		for (const [key, child] of Object.entries(record)) {
			if (child === "a") continue;
			if (Array.isArray(child) && child[2] === 0) {
				removal(key, child[0]);
				continue;
			}
			visit(
				child,
				valueAt(oldValue, key),
				valueAt(newValue, key),
				childPointer(pointer, key),
				childPointer(oldPointer, key),
				[...path, key],
			);
		}
	};
	if (Array.isArray(delta) && delta[2] === 0) {
		removed.set("", { kind: "removed", pointer: "", oldValue: delta[0] });
	} else {
		visit(delta, original, modified, "", "", []);
	}
	return { current, removed };
}

function valueAt(value: unknown, key: string): unknown {
	return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

export function classifyJsonDiff(original: unknown, modified: unknown): JsonDiffClassification {
	const delta = patcher.diff(original, modified);
	return { delta, ...classifyJsonDelta(delta, original, modified) };
}

export function oldToRenderedJsonPointers(
	original: unknown,
	modified: unknown,
	delta: Delta,
): ReadonlyMap<string, string> {
	const pointers = new Map<string, string>();
	const visit = (
		oldValue: unknown,
		newValue: unknown,
		part: unknown,
		oldPointer: string,
		newPointer: string,
	) => {
		pointers.set(oldPointer, newPointer);
		if (Array.isArray(part)) return;
		const record = deltaRecord(part);
		if (Array.isArray(oldValue) && Array.isArray(newValue)) {
			if (record && record._t !== "a") return;
			const indexes = record
				? arrayIndexMap(record, oldValue.length, newValue.length)
				: oldValue.length === newValue.length
					? new Map(oldValue.map((_value, index) => [index, index]))
					: null;
			if (!indexes) return;
			for (const [oldIndex, newIndex] of indexes) {
				visit(
					oldValue[oldIndex],
					newValue[newIndex],
					record?.[String(newIndex)],
					childPointer(oldPointer, oldIndex),
					childPointer(newPointer, newIndex),
				);
			}
			return;
		}
		if (
			oldValue === null ||
			newValue === null ||
			typeof oldValue !== "object" ||
			typeof newValue !== "object"
		) {
			return;
		}
		if (record?._t === "a") return;
		for (const key of Object.keys(oldValue)) {
			if (!Object.hasOwn(newValue, key)) continue;
			const child = record?.[key];
			if (removedDelta(child)) continue;
			visit(
				Reflect.get(oldValue, key),
				Reflect.get(newValue, key),
				child,
				childPointer(oldPointer, key),
				childPointer(newPointer, key),
			);
		}
	};
	visit(original, modified, delta, "", "");
	return pointers;
}

function parentPointer(pointer: string): string | null {
	return pointer.length === 0 ? null : pointer.slice(0, pointer.lastIndexOf("/"));
}

function mergeFirst(
	left: readonly JsonNestedChange[],
	right: readonly JsonNestedChange[],
	limit: number,
): JsonNestedChange[] {
	const merged: JsonNestedChange[] = [];
	let l = 0;
	let r = 0;
	while (merged.length < limit) {
		const a = left[l];
		const b = right[r];
		if (a && (!b || a.order < b.order)) {
			merged.push(a);
			l += 1;
		} else if (b) {
			merged.push(b);
			r += 1;
		} else break;
	}
	return merged;
}

export function jsonPathLabel(path: readonly JsonPathSegment[]): string {
	return path
		.map((segment, index) => {
			if (typeof segment === "number") return `[${segment}]`;
			if (!/^[A-Za-z_$][\w$]*$/.test(segment)) return `[${JSON.stringify(segment)}]`;
			return index === 0 ? segment : `.${segment}`;
		})
		.join("");
}

export function jsonPointerDepth(pointer: string): number {
	let depth = 0;
	for (const char of pointer) if (char === "/") depth += 1;
	return depth;
}

export function nestedJsonDiffChanges(
	classification: Omit<JsonDiffClassification, "delta">,
	renderedLine: (pointer: string) => number,
	limit: number,
): ReadonlyMap<string, JsonNestedChanges> {
	const leaves: {
		mark: JsonDiffMark;
		path: readonly JsonPathSegment[];
		holder: string;
		line: number;
	}[] = [];
	for (const mark of classification.current.values()) {
		const holder = parentPointer(mark.pointer);
		if (holder === null || !mark.path) continue;
		leaves.push({ mark, path: mark.path, holder, line: renderedLine(mark.pointer) });
	}
	for (const mark of classification.removed.values()) {
		const holder = mark.renderedParent;
		if (holder === undefined || !mark.path) continue;
		leaves.push({ mark, path: mark.path, holder, line: renderedLine(holder) });
	}
	leaves.sort((left, right) => left.line - right.line);
	const changes = new Map<string, { total: number; first: JsonNestedChange[] }>();
	const byDepth: string[][] = [];
	const holderOf = (pointer: string) => {
		let entry = changes.get(pointer);
		if (!entry) {
			entry = { total: 0, first: [] };
			changes.set(pointer, entry);
			const depth = jsonPointerDepth(pointer);
			const bucket = byDepth[depth] ?? [];
			bucket.push(pointer);
			byDepth[depth] = bucket;
		}
		return entry;
	};
	leaves.forEach(({ mark, path, holder }, order) => {
		const entry = holderOf(holder);
		entry.total += 1;
		if (entry.first.length < limit) entry.first.push({ mark, path, order });
	});
	for (let depth = byDepth.length - 1; depth > 0; depth -= 1) {
		for (const pointer of byDepth[depth] ?? []) {
			const child = changes.get(pointer);
			const parent = parentPointer(pointer);
			if (!child || parent === null) continue;
			const target = holderOf(parent);
			target.total += child.total;
			target.first = mergeFirst(target.first, child.first, limit);
		}
	}
	return changes;
}
