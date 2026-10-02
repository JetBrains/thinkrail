import { create, type Delta } from "jsondiffpatch";

export type JsonDiffKind = "added" | "removed" | "changed" | "moved";

export interface JsonDiffMark {
	kind: JsonDiffKind;
	pointer: string;
	oldPointer?: string;
	oldValue?: unknown;
	newValue?: unknown;
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

export function classifyJsonDelta(delta: Delta): Omit<JsonDiffClassification, "delta"> {
	const current = new Map<string, JsonDiffMark>();
	const removed = new Map<string, JsonDiffMark>();
	const visit = (part: Delta, pointer: string) => {
		if (part === undefined) return;
		if (Array.isArray(part)) {
			const tuple = part as unknown[];
			if (tuple.length === 1) {
				current.set(pointer, { kind: "added", pointer, newValue: tuple[0] });
				return;
			}
			if (tuple.length === 2) {
				current.set(pointer, {
					kind: "changed",
					pointer,
					oldValue: tuple[0],
					newValue: tuple[1],
				});
				return;
			}
			if (tuple[2] === 0) {
				removed.set(pointer, { kind: "removed", pointer, oldValue: tuple[0] });
				return;
			}
			if (tuple[2] === 2) {
				current.set(pointer, { kind: "changed", pointer, oldValue: tuple[0] });
			}
			return;
		}
		const record = part as { [key: string]: Delta | "a" };
		if (record._t === "a") {
			for (const [key, child] of Object.entries(record)) {
				if (key === "_t" || child === undefined || child === "a") continue;
				if (key.startsWith("_")) {
					const oldIndex = Number(key.slice(1));
					if (Array.isArray(child) && child[2] === 3 && typeof child[1] === "number") {
						const nextPointer = childPointer(pointer, child[1]);
						current.set(nextPointer, {
							kind: "moved",
							pointer: nextPointer,
							oldPointer: childPointer(pointer, oldIndex),
							oldValue: child[0],
						});
					} else {
						visit(child, childPointer(pointer, oldIndex));
					}
					continue;
				}
				visit(child, childPointer(pointer, key));
			}
			return;
		}
		for (const [key, child] of Object.entries(record)) {
			if (child !== "a") visit(child, childPointer(pointer, key));
		}
	};
	visit(delta, "");
	return { current, removed };
}

export function classifyJsonDiff(original: unknown, modified: unknown): JsonDiffClassification {
	const delta = patcher.diff(original, modified);
	return { delta, ...classifyJsonDelta(delta) };
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
