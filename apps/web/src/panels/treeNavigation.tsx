import { isContextMenuKey } from "@thinkrail/ui/context-menu";
import { isImeComposing } from "@thinkrail/ui/keyboard";
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
import { hasPlatformModifier } from "../lib";

const TREE = '[role="tree"]';
const TREE_ITEM = '[role="treeitem"]';
const TYPE_AHEAD_MS = 500;

export interface TreeRowModel {
	level: number;
	expanded: boolean | undefined;
	label: string;
}

export type TreeMove = { kind: "focus"; index: number } | { kind: "toggle" } | { kind: "stay" };

export interface TypeAhead {
	text: string;
	at: number;
}

export type TreeRowKey = "menu" | "delete" | "rename";

const STAY: TreeMove = { kind: "stay" };
const TOGGLE: TreeMove = { kind: "toggle" };
const focusRow = (index: number): TreeMove => ({ kind: "focus", index });

export function resolveTreeMove(
	key: string,
	rows: readonly TreeRowModel[],
	index: number,
): TreeMove | null {
	const row = rows[index];
	if (!row) return null;
	switch (key) {
		case "ArrowDown":
			return index + 1 < rows.length ? focusRow(index + 1) : STAY;
		case "ArrowUp":
			return index > 0 ? focusRow(index - 1) : STAY;
		case "Home":
			return focusRow(0);
		case "End":
			return focusRow(rows.length - 1);
		case "ArrowRight":
			if (row.expanded === false) return TOGGLE;
			return row.expanded === true && (rows[index + 1]?.level ?? 0) > row.level
				? focusRow(index + 1)
				: STAY;
		case "ArrowLeft": {
			if (row.expanded === true) return TOGGLE;
			const parent = rows.slice(0, index).findLastIndex((other) => other.level < row.level);
			return parent >= 0 ? focusRow(parent) : STAY;
		}
		default:
			return null;
	}
}

export function extendTypeAhead(previous: TypeAhead, key: string, now: number): TypeAhead | null {
	const live = previous.text !== "" && now - previous.at <= TYPE_AHEAD_MS;
	if (key === " " && !live) return null;
	return { text: live ? previous.text + key : key, at: now };
}

export function typeAheadTarget(
	labels: readonly string[],
	index: number,
	text: string,
): number | null {
	const query = text.toLocaleLowerCase();
	const needle = [...query].every((char) => char === query[0]) ? query.slice(0, 1) : query;
	const start = needle.length === 1 ? index + 1 : index;
	for (let offset = 0; offset < labels.length; offset++) {
		const at = (start + offset) % labels.length;
		if (labels[at]?.toLocaleLowerCase().startsWith(needle)) return at;
	}
	return null;
}

export function treeRowKey(
	event: Pick<
		KeyboardEvent,
		"key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "defaultPrevented"
	>,
): TreeRowKey | null {
	if (event.defaultPrevented) return null;
	if (isContextMenuKey(event)) return "menu";
	if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return null;
	if (event.key === "Delete") return "delete";
	if (event.key === "F2") return "rename";
	return null;
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

interface TreeScope {
	cursor: TreeCursor;
	focusDefault: boolean;
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

export function Tree({
	label,
	focusList,
	className,
	focusDefault = true,
	onOpenKept,
	children,
}: {
	label: string;
	focusList: string;
	className: string;
	focusDefault?: boolean;
	onOpenKept?: (id: string) => void;
	children: ReactNode;
}) {
	const [cursor] = useState(createTreeCursor);
	const typeAhead = useRef<TypeAhead>({ text: "", at: 0 });
	const scope = useMemo(() => ({ cursor, focusDefault }), [cursor, focusDefault]);

	const ref = useCallback(
		(container: HTMLElement | null) => {
			if (!container) return;
			const observer = new MutationObserver((records) => reconcile(container, cursor, records));
			observer.observe(container, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["aria-current"],
			});
			reconcile(container, cursor, []);
			return () => observer.disconnect();
		},
		[cursor],
	);

	const onFocus = (event: FocusEvent<HTMLElement>) => {
		const item = ownItem(event.currentTarget, event.target);
		if (item) cursor.set(item.dataset.treeItem ?? null, true);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.defaultPrevented || isImeComposing(event.nativeEvent)) return;
		const container = event.currentTarget;
		const item = ownItem(container, event.target);
		if (!item) return;
		if (event.key === "Enter" && hasPlatformModifier(event) && !event.altKey && !event.shiftKey) {
			event.preventDefault();
			const id = item.dataset.treeItem;
			if (onOpenKept && id !== undefined && item.dataset.treeKeep !== undefined) onOpenKept(id);
			else item.click();
			return;
		}
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const items = treeItems(container);
		const index = items.indexOf(item);
		const move = event.shiftKey ? null : resolveTreeMove(event.key, items.map(rowModel), index);
		if (move) {
			event.preventDefault();
			if (move.kind === "focus") items[move.index]?.focus();
			else if (move.kind === "toggle") toggleOf(container, item)?.click();
			return;
		}
		if (event.key.length !== 1) return;
		const next = extendTypeAhead(typeAhead.current, event.key, event.timeStamp);
		if (!next) return;
		typeAhead.current = next;
		event.preventDefault();
		const labels = items.map((each) => rowModel(each).label);
		const target = typeAheadTarget(labels, index, next.text);
		if (target !== null) items[target]?.focus();
	};

	return (
		<TreeContext value={scope}>
			<div
				ref={ref}
				role="tree"
				aria-label={label}
				data-focus-list={focusList}
				className={className}
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
	};
}

export function treeToggleProps(id: string) {
	return { tabIndex: -1, "data-tree-toggle": id };
}

export function focusTreeItemOnMenuClose(event: Event, row: Element | null): void {
	event.preventDefault();
	const active = document.activeElement;
	if (active !== null && active !== document.body) return;
	row?.querySelector<HTMLElement>(TREE_ITEM)?.focus();
}
