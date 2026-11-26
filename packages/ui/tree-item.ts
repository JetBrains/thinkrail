import { createContext, use, useSyncExternalStore } from "react";

export type TreeMatch = "match" | "current";

export interface TreeItemScope {
	cursor: { current(): string | null; subscribe(listener: () => void): () => void };
	marks: { of(id: string): TreeMatch | undefined; subscribe(listener: () => void): () => void };
	focusDefault: boolean;
}

export const TreeItemScopeContext = createContext<TreeItemScope | null>(null);

const subscribeNothing = () => () => {};

export function useTreeItem(
	id: string,
	{
		level,
		label,
		expanded,
		selected = false,
		toggles = false,
		openKept = false,
	}: {
		level: number;
		label: string;
		expanded?: boolean | undefined;
		selected?: boolean;
		toggles?: boolean;
		openKept?: boolean;
	},
) {
	const scope = use(TreeItemScopeContext);
	const current = useSyncExternalStore(
		scope?.cursor.subscribe ?? subscribeNothing,
		() => scope?.cursor.current() === id,
		() => false,
	);
	const match = useSyncExternalStore(
		scope?.marks.subscribe ?? subscribeNothing,
		() => scope?.marks.of(id),
		() => undefined,
	);
	return {
		role: "treeitem" as const,
		tabIndex: scope ? (current ? 0 : -1) : undefined,
		"aria-level": level,
		"aria-expanded": expanded,
		"aria-current": selected ? ("true" as const) : undefined,
		"data-tree-item": id,
		"data-tree-label": label,
		"data-tree-toggle": toggles ? id : undefined,
		"data-tree-keep": openKept || undefined,
		"data-focus-default": (current && scope?.focusDefault) || undefined,
		"data-tree-match": match,
	};
}
