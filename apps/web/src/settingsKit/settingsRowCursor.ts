import { createContext, use, useCallback, useSyncExternalStore } from "react";

export const SETTINGS_ROW_FOCUS =
	"focus-visible:focus-ring-row has-[:focus-visible]:focus-ring-row";

export const SETTINGS_ROW_INSET = "px-8";

const FOLLOWING = 4;

export interface CursorRow {
	compareDocumentPosition(other: CursorRow): number;
}

export interface SettingsRowCursor {
	current(): string | null;
	active(): string | null;
	set(rowId: string | null): void;
	mount(rowId: string, row: CursorRow): () => void;
	subscribe(listener: () => void): () => void;
}

function firstRow(rows: ReadonlyMap<string, CursorRow>): string | null {
	let first: [string, CursorRow] | null = null;
	for (const entry of rows) {
		if (!first || (entry[1].compareDocumentPosition(first[1]) & FOLLOWING) !== 0) first = entry;
	}
	return first?.[0] ?? null;
}

export function createSettingsRowCursor(): SettingsRowCursor {
	let current: string | null = null;
	let active: string | null = null;
	const rows = new Map<string, CursorRow>();
	const listeners = new Set<() => void>();
	const settle = () => {
		const next = current !== null && rows.has(current) ? current : firstRow(rows);
		if (next === active) return;
		active = next;
		for (const listener of listeners) listener();
	};
	return {
		current: () => current,
		active: () => active,
		set(rowId) {
			current = rowId;
			settle();
		},
		mount(rowId, row) {
			rows.set(rowId, row);
			settle();
			return () => {
				if (rows.get(rowId) === row) rows.delete(rowId);
				settle();
			};
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export const SettingsRowCursorContext = createContext<SettingsRowCursor | null>(null);

const subscribeNothing = () => () => {};

export interface SettingsRowRoving {
	readonly tabIndex: 0 | -1;
	readonly ref: (element: HTMLElement | null) => (() => void) | undefined;
}

export function useSettingsRowRoving(rowId: string | undefined): SettingsRowRoving {
	const cursor = use(SettingsRowCursorContext);
	const active = useSyncExternalStore(
		cursor?.subscribe ?? subscribeNothing,
		() => rowId !== undefined && cursor?.active() === rowId,
		() => false,
	);
	const ref = useCallback(
		(element: HTMLElement | null) =>
			element && cursor && rowId !== undefined ? cursor.mount(rowId, element) : undefined,
		[cursor, rowId],
	);
	return { tabIndex: active ? 0 : -1, ref };
}

export function useSettingsRowStop(rowId: string) {
	return { "data-setting-row": rowId, ...useSettingsRowRoving(rowId) } as const;
}
