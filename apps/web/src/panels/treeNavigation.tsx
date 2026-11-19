import { useT } from "@thinkrail/locales/react";
import { isContextMenuKey } from "@thinkrail/ui/context-menu";
import { isImeComposing, twinArrow } from "@thinkrail/ui/keyboard";
import { type LocalKeyEvent, type LocalKeys, useLocalKeys } from "@thinkrail/ui/local-keys";
import { cn } from "@thinkrail/ui/utils";
import {
	createContext,
	type FocusEvent,
	type KeyboardEvent,
	type ReactNode,
	use,
	useCallback,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";
import { resolveTreeMove, type TreeMove, type TreeMoveRow } from "../lib";

const TREE = '[role="tree"]';
const TREE_ITEM = '[role="treeitem"]';
const HINT_MODE_CODE = "KeyF";
const MATCH_STYLES =
	"[&_[data-tree-match=match]]:bg-primary-subtle [&_[data-tree-match=current]]:bg-primary-soft";

export interface TreeRowModel extends TreeMoveRow {
	label: string;
}

export interface TreeSearchRow {
	id: string;
	label: string;
}

export type TreeRowKey = "menu" | "delete" | "rename" | "reorderUp" | "reorderDown";

const ROW_COMMANDS: Readonly<Record<string, TreeRowKey>> = {
	"trees.delete": "delete",
	"trees.rename": "rename",
	"trees.reorderUp": "reorderUp",
	"trees.reorderDown": "reorderDown",
};

function matchIndexes(rows: readonly TreeSearchRow[], query: string): number[] {
	const needle = query.toLocaleLowerCase();
	if (needle === "") return [];
	return rows.flatMap((row, index) =>
		row.label.toLocaleLowerCase().includes(needle) ? [index] : [],
	);
}

export function treeSearchMatches(rows: readonly TreeSearchRow[], query: string): string[] {
	return matchIndexes(rows, query).flatMap((index) => rows[index]?.id ?? []);
}

export function treeSearchTarget(
	rows: readonly TreeSearchRow[],
	query: string,
	anchor: string | null,
): string | null {
	const matches = matchIndexes(rows, query);
	const start = Math.max(
		0,
		rows.findIndex((row) => row.id === anchor),
	);
	const at = matches.find((index) => index >= start) ?? matches[0];
	return at === undefined ? null : (rows[at]?.id ?? null);
}

export function treeSearchStep(
	rows: readonly TreeSearchRow[],
	query: string,
	current: string | null,
	delta: 1 | -1,
): string | null {
	const matches = matchIndexes(rows, query);
	const index = rows.findIndex((row) => row.id === current);
	const at =
		delta === 1
			? (matches.find((each) => each > index) ?? matches[0])
			: (matches.findLast((each) => each < (index === -1 ? rows.length : index)) ?? matches.at(-1));
	return at === undefined ? null : (rows[at]?.id ?? null);
}

export function treeKeyMove(
	key: string | null,
	rows: readonly TreeMoveRow[],
	index: number,
	leaveAtEdges: boolean,
): TreeMove | "leave" | null {
	const move = key === null ? null : resolveTreeMove(key, rows, index);
	return leaveAtEdges && move?.kind === "stay" ? "leave" : move;
}

export function useTreeKeys(): LocalKeys {
	return useLocalKeys("trees", LOCAL_KEY_DEFAULTS.trees);
}

export function treeRowKey(
	event: LocalKeyEvent & { readonly defaultPrevented: boolean },
	keys: Pick<LocalKeys, "match">,
): TreeRowKey | null {
	if (event.defaultPrevented) return null;
	if (isContextMenuKey(event)) return "menu";
	return ROW_COMMANDS[keys.match(event) ?? ""] ?? null;
}

function createTreeCursor() {
	let current: string | null = null;
	let pinned = false;
	const listeners = new Set<() => void>();
	return {
		current: () => current,
		pinned: () => pinned,
		set(id: string | null, pin: boolean) {
			pinned = pin;
			if (id === current) return;
			current = id;
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

type TreeCursor = ReturnType<typeof createTreeCursor>;

type TreeMatch = "match" | "current";

function createTreeMarks() {
	let matches: ReadonlySet<string> = new Set();
	let current: string | null = null;
	const listeners = new Set<() => void>();
	return {
		of: (id: string): TreeMatch | undefined =>
			id === current ? "current" : matches.has(id) ? "match" : undefined,
		set(nextMatches: readonly string[], nextCurrent: string | null) {
			matches = new Set(nextMatches);
			current = nextCurrent;
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

type TreeMarks = ReturnType<typeof createTreeMarks>;

interface TreeScope {
	cursor: TreeCursor;
	marks: TreeMarks;
	focusDefault: boolean;
}

interface TreeSearch {
	origin: string | null;
	current: string | null;
	query: string;
	matches: readonly string[];
}

const TreeContext = createContext<TreeScope | null>(null);

function ownItem(container: Element, target: EventTarget | null): HTMLElement | null {
	return target instanceof HTMLElement &&
		target.matches(TREE_ITEM) &&
		target.closest(TREE) === container
		? target
		: null;
}

function treeItems(container: Element): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(TREE_ITEM)).filter(
		(item) => item.closest(TREE) === container,
	);
}

function rowModel(item: HTMLElement): TreeRowModel {
	const expanded = item.getAttribute("aria-expanded");
	return {
		level: Number(item.getAttribute("aria-level")) || 1,
		expanded: expanded === null ? undefined : expanded === "true",
		label: item.dataset.treeLabel ?? item.textContent ?? "",
	};
}

const isSelected = (item: HTMLElement) => item.getAttribute("aria-current") === "true";

const touches = (record: MutationRecord, item: HTMLElement) =>
	record.type === "attributes"
		? record.target === item
		: Array.from(record.addedNodes).some((node) => node.contains(item));

function toggleOf(container: Element, item: HTMLElement): HTMLElement | undefined {
	if (item.dataset.treeToggle !== undefined) return item;
	return Array.from(container.querySelectorAll<HTMLElement>("[data-tree-toggle]")).find(
		(toggle) =>
			toggle.dataset.treeToggle === item.dataset.treeItem && toggle.closest(TREE) === container,
	);
}

function reconcile(container: Element, cursor: TreeCursor, records: readonly MutationRecord[]) {
	const items = treeItems(container);
	if (!container.contains(document.activeElement)) {
		const chosen = items.findLast(
			(item) => isSelected(item) && records.some((record) => touches(record, item)),
		);
		if (chosen) {
			cursor.set(chosen.dataset.treeItem ?? null, true);
			return;
		}
	}
	const current = cursor.current();
	const present = current !== null && items.some((item) => item.dataset.treeItem === current);
	if (present && cursor.pinned()) return;
	const selected = items.findLast(isSelected);
	if (selected) cursor.set(selected.dataset.treeItem ?? null, true);
	else if (!present) cursor.set(items[0]?.dataset.treeItem ?? null, false);
}

const subscribeNothing = () => () => {};

function searchRows(container: Element): TreeSearchRow[] {
	return treeItems(container).map((item) => ({
		id: item.dataset.treeItem ?? "",
		label: rowModel(item).label,
	}));
}

function itemById(container: Element, id: string | null): HTMLElement | undefined {
	return id === null
		? undefined
		: treeItems(container).find((item) => item.dataset.treeItem === id);
}

function reveal(row: HTMLElement, field: HTMLElement | null): void {
	row.scrollIntoView({ block: "nearest" });
	if (field && field.getBoundingClientRect().bottom > row.getBoundingClientRect().top) {
		row.scrollIntoView({ block: "center" });
	}
}

const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

function TreeSearchField({
	tree,
	search,
	fieldRef,
	onQuery,
	onStep,
	onClose,
}: {
	tree: string;
	search: TreeSearch;
	fieldRef: (node: HTMLDivElement | null) => void;
	onQuery: (query: string) => void;
	onStep: (delta: 1 | -1) => void;
	onClose: (keep: boolean, moveFocus: boolean) => void;
}) {
	const t = useT();
	const { matches } = search;
	return (
		<div
			ref={fieldRef}
			className="sticky top-0 z-10 flex items-center gap-8 bg-container-sidebar-bg px-8 py-4"
		>
			<input
				ref={focusOnMount}
				type="text"
				value={search.query}
				aria-label={t("panels.treeSearch.label", { tree })}
				placeholder={t("panels.treeSearch.placeholder")}
				data-testid="tree-search"
				aria-keyshortcuts="ArrowDown ArrowUp Enter Escape"
				className="h-24 min-w-0 flex-1 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default transition-colors placeholder:text-text-muted focus:border-control-border-active focus-visible:focus-ring"
				onChange={(event) => onQuery(event.target.value)}
				onBlur={() => onClose(true, false)}
				onKeyDown={(event) => {
					if (isImeComposing(event.nativeEvent)) return;
					if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						onStep(event.key === "ArrowDown" ? 1 : -1);
					} else if (event.key === "Enter" || event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						onClose(event.key === "Enter", true);
					}
				}}
			/>
			{search.query === "" ? null : (
				<span data-testid="tree-search-count" className="shrink-0 tr-text-metadata text-text-muted">
					{matches.length === 0
						? t("panels.treeSearch.none")
						: t("panels.treeSearch.count", {
								current: matches.indexOf(search.current ?? "") + 1,
								total: matches.length,
							})}
				</span>
			)}
		</div>
	);
}

export function Tree({
	label,
	focusList,
	className,
	focusDefault = true,
	leaveAtEdges = false,
	onOpenKept,
	children,
}: {
	label: string;
	focusList: string;
	className: string;
	focusDefault?: boolean;
	leaveAtEdges?: boolean;
	onOpenKept?: (id: string) => void;
	children: ReactNode;
}) {
	const [cursor] = useState(createTreeCursor);
	const [marks] = useState(createTreeMarks);
	const [search, setSearch] = useState<TreeSearch | null>(null);
	const searching = useRef(false);
	const tree = useRef<HTMLElement | null>(null);
	const field = useRef<HTMLDivElement | null>(null);
	const keys = useTreeKeys();
	const scope = useMemo(() => ({ cursor, marks, focusDefault }), [cursor, marks, focusDefault]);

	const ref = useCallback(
		(container: HTMLElement | null) => {
			tree.current = container;
			if (!container) return;
			const observer = new MutationObserver((records) => reconcile(container, cursor, records));
			observer.observe(container, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["aria-current"],
			});
			reconcile(container, cursor, []);
			return () => {
				observer.disconnect();
				tree.current = null;
			};
		},
		[cursor],
	);

	const showMatch = (
		origin: string | null,
		query: string,
		pick: (rows: TreeSearchRow[]) => string | null,
	) => {
		const container = tree.current;
		if (!container) return;
		const rows = searchRows(container);
		const current = pick(rows);
		const matches = treeSearchMatches(rows, query);
		setSearch({ origin, query, current, matches });
		marks.set(matches, current);
		const row = itemById(container, current ?? origin);
		if (!row) return;
		cursor.set(row.dataset.treeItem ?? null, true);
		reveal(row, field.current);
	};

	const closeSearch = (keep: boolean, moveFocus: boolean) => {
		if (search === null || !searching.current) return;
		searching.current = false;
		const container = tree.current;
		const row = container
			? (itemById(container, keep ? (search.current ?? search.origin) : search.origin) ??
				itemById(container, cursor.current()))
			: undefined;
		if (row) {
			cursor.set(row.dataset.treeItem ?? null, true);
			if (moveFocus) row.focus();
		}
		marks.set([], null);
		setSearch(null);
	};

	const onFocus = (event: FocusEvent<HTMLElement>) => {
		const item = ownItem(event.currentTarget, event.target);
		if (item) cursor.set(item.dataset.treeItem ?? null, true);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.defaultPrevented || isImeComposing(event.nativeEvent)) return;
		const container = event.currentTarget;
		const item = ownItem(container, event.target);
		if (!item) return;
		const local = keys.match(event.nativeEvent);
		if (local === "trees.search") {
			event.preventDefault();
			searching.current = true;
			setSearch({ origin: item.dataset.treeItem ?? null, current: null, query: "", matches: [] });
			return;
		}
		if (local === "trees.openKept") {
			event.preventDefault();
			const id = item.dataset.treeItem;
			if (onOpenKept && id !== undefined && item.dataset.treeKeep !== undefined) onOpenKept(id);
			else item.click();
			return;
		}
		const twin = twinArrow(local);
		if (twin === undefined && (event.altKey || event.ctrlKey || event.metaKey)) return;
		const items = treeItems(container);
		const index = items.indexOf(item);
		const key = twin ?? (event.shiftKey ? null : event.key);
		const move = treeKeyMove(key, items.map(rowModel), index, leaveAtEdges);
		if (move === "leave") return;
		if (move) {
			event.preventDefault();
			if (move.kind === "focus") items[move.index]?.focus();
			else if (move.kind === "toggle") toggleOf(container, item)?.click();
			return;
		}
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.key.length !== 1 || event.key === " ") return;
		if (event.code === HINT_MODE_CODE && !event.shiftKey) return;
		event.preventDefault();
	};

	return (
		<TreeContext value={scope}>
			{search ? (
				<TreeSearchField
					tree={label}
					search={search}
					fieldRef={(node) => {
						field.current = node;
					}}
					onQuery={(query) =>
						showMatch(search.origin, query, (rows) =>
							treeSearchTarget(rows, query, search.current ?? search.origin),
						)
					}
					onStep={(delta) =>
						showMatch(search.origin, search.query, (rows) =>
							treeSearchStep(rows, search.query, search.current ?? search.origin, delta),
						)
					}
					onClose={closeSearch}
				/>
			) : null}
			<div
				ref={ref}
				role="tree"
				data-key-scope="trees"
				aria-label={label}
				data-focus-list={focusList}
				className={cn(className, MATCH_STYLES)}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
			>
				<ul role="none" className="contents">
					{children}
				</ul>
			</div>
		</TreeContext>
	);
}

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
	const scope = use(TreeContext);
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

export const treeRowControlProps = { tabIndex: -1, "aria-hidden": true } as const;

export function treeToggleProps(id: string) {
	return { ...treeRowControlProps, "data-tree-toggle": id };
}

export function focusTreeItemOnMenuClose(event: Event, row: Element | null): void {
	event.preventDefault();
	const active = document.activeElement;
	if (active !== null && active !== document.body) return;
	row?.querySelector<HTMLElement>(TREE_ITEM)?.focus();
}
