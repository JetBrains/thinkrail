import {
	RiCornerDownLeftLine,
	RiInformationLine,
	RiSearchLine,
	RiSideBarLine,
	RiWifiOffLine,
} from "@remixicon/react";
import {
	MAX_SEARCH_GROUP_LIMIT,
	MAX_SEARCH_PREVIEW_BYTES,
	MAX_SEARCH_QUERY_LENGTH,
	type SearchContext,
	type SearchHit,
	type SearchPreviewResult,
	type SearchPreviewTarget,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useEffect,
	useInsertionEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { shortcutKeys } from "../commands";
import { AttentionDot } from "../components/AttentionDot";
import { RunningIcon } from "../components/RunningIcon";
import { hasPlatformModifier } from "../lib";
import { NO_ARRIVALS, noteArrivals, type PinnedRow, withPinned } from "./arrivals";
import { hostItems, hostTotals } from "./hostItems";
import {
	createHostPreviewLoader,
	type HostPreviewLoader,
	type HostSearchStatus,
	hostSearchStatus,
	useHostSearch,
} from "./hostSearch";
import { isImeComposing } from "./ime";
import { recordPick } from "./learning";
import type { PaletteFile, PaletteItem, PaletteRow, PaletteSection, PaletteStart } from "./model";
import { readLearning, readPreviewOpen, writeLearning, writePreviewOpen } from "./preferences";
import {
	parseSearchQuery,
	SCOPE_PREFIX,
	type SearchScope,
	scopeKinds,
	stripScopePrefix,
	withScopePrefix,
} from "./query";
import { matchingIds } from "./rank";
import { buildSections, flattenRows, startEligible, startPrompt } from "./sections";

const HOST_STATUS_LABELS: Record<HostSearchStatus, MessageKey> = {
	failed: "search.palette.hostFailed",
	indexing: "search.palette.hostIndexing",
	truncated: "search.palette.hostTruncated",
};

const SCOPE_LABELS: Record<SearchScope, MessageKey> = {
	all: "search.scope.all",
	work: "search.scope.work",
	files: "search.scope.files",
	specs: "search.scope.specs",
	commands: "search.scope.commands",
};

export interface PaletteHost {
	readonly context: SearchContext;
	readonly openHit: (hit: SearchHit) => void;
	readonly projectName: (projectId: string) => string | undefined;
	readonly workspaceName: (workspaceId: string) => string | undefined;
	readonly renderFilePreview: (file: PaletteFile) => ReactNode;
}

export interface SearchPaletteProps {
	readonly onClose: () => void;
	readonly rootItems: readonly PaletteItem[];
	readonly waiting: readonly PaletteItem[];
	readonly actions: readonly PaletteItem[];
	readonly scopes: readonly SearchScope[];
	readonly host?: PaletteHost;
	readonly start?: PaletteStart;
	readonly notice?: string;
}

export function SearchPalette(props: SearchPaletteProps) {
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
		>
			<PaletteContent {...props} />
		</Dialog>
	);
}

function PaletteContent({
	onClose,
	rootItems,
	waiting,
	actions: emptyActions,
	scopes,
	host,
	start,
	notice,
}: SearchPaletteProps) {
	const t = useT();
	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_GROUPS);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [arrivals, setArrivals] = useState(NO_ARRIVALS);
	const [pinned, setPinned] = useState<PinnedRow | null>(null);
	const onScreen = useRef<ReadonlySet<string>>(new Set());
	const holdingSelection = useRef(false);
	const [previewOpen, setPreviewOpen] = useState(readPreviewOpen);
	const [learning, setLearning] = useState(readLearning);
	const [nowMs] = useState(Date.now);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const parsed = useMemo(() => {
		const result = parseSearchQuery(query);
		return scopes.includes(result.scope) ? result : parseSearchQuery(stripScopePrefix(query));
	}, [query, scopes]);
	const hostEnabled = host !== undefined;
	const hostProjectId = host?.context.projectId;
	const hostWorkspaceId = host?.context.workspaceId;
	const hostInput = useMemo(
		() => ({
			enabled: hostEnabled,
			text: parsed.text,
			kinds: scopeKinds(parsed.scope),
			context: {
				...(hostProjectId ? { projectId: hostProjectId } : {}),
				...(hostWorkspaceId ? { workspaceId: hostWorkspaceId } : {}),
			},
			...(parsed.scope === "all" ? {} : { limit: MAX_SEARCH_GROUP_LIMIT }),
		}),
		[hostEnabled, hostProjectId, hostWorkspaceId, parsed.text, parsed.scope],
	);
	const hostState = useHostSearch(hostInput);
	const [previews] = useState(createHostPreviewLoader);
	useLayoutEffect(() => {
		const landed = hostState.stale
			? []
			: (hostState.groups?.flatMap((group) => group.hits.map((hit) => hit.id)) ?? []);
		const shown = onScreen.current;
		const holding = holdingSelection.current;
		setArrivals((current) => noteArrivals(current, landed, shown, holding));
	}, [hostState.groups, hostState.stale]);
	const localMatches = useMemo(
		() => matchingIds(rootItems, parsed.terms),
		[rootItems, parsed.terms],
	);
	const hostRows = useMemo(() => {
		if (!host || !hostState.groups || hostState.groups.length === 0) return [];
		const context = {
			t,
			openHit: host.openHit,
			projectName: host.projectName,
			workspaceName: host.workspaceName,
			localIds: localMatches,
			late: arrivals.late,
			staleTerms: hostState.stale ? parsed.terms : null,
		};
		return hostItems(context, hostState.groups);
	}, [host, hostState.groups, hostState.stale, parsed.terms, localMatches, t, arrivals]);
	const allItems = useMemo(() => {
		const listed = new Set([...localMatches, ...hostRows.map((item) => item.id)]);
		return withPinned([...rootItems, ...hostRows], pinned, hostInput, listed);
	}, [rootItems, hostRows, localMatches, pinned, hostInput]);
	const totals = useMemo(
		() => (hostState.groups && !hostState.stale ? hostTotals(hostState.groups) : {}),
		[hostState.groups, hostState.stale],
	);
	const hostStatus = hostSearchStatus(hostState);
	const startText = startEligible(parsed) ? startPrompt(parsed.raw, parsed) : "";
	const startInput = useMemo(
		() => (start && startText ? { start, text: startText } : undefined),
		[start, startText],
	);
	const sections = useMemo(
		() =>
			buildSections({
				t,
				parsed,
				hostTotals: totals,
				...(startInput ? { start: startInput } : {}),
				rootItems: allItems,
				waiting,
				actions: emptyActions,
				expanded,
				learning,
				nowMs,
				keep: selectedId,
			}),
		[
			t,
			parsed,
			totals,
			startInput,
			allItems,
			waiting,
			emptyActions,
			expanded,
			learning,
			nowMs,
			selectedId,
		],
	);
	const rows = useMemo(() => flattenRows(sections), [sections]);
	useLayoutEffect(() => {
		onScreen.current = new Set(rows.map((row) => row.item.id));
		holdingSelection.current = selectedId !== null;
	}, [rows, selectedId]);
	const selectedIndex = Math.max(
		0,
		rows.findIndex((row) => row.item.id === selectedId),
	);
	const selected = rows[selectedIndex] ?? null;

	const selectedIndexRef = useRef(selectedIndex);
	useInsertionEffect(() => {
		selectedIndexRef.current = selectedIndex;
	});
	useEffect(() => {
		listRef.current
			?.querySelector(`[data-index="${selectedIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	const select = (index: number) => {
		const row = rows[(index + rows.length) % rows.length];
		if (!row) return;
		setSelectedId(row.item.id);
		const hostRow = row.item === pinned?.item || hostRows.includes(row.item);
		setPinned(hostRow ? { item: row.item, input: hostInput } : null);
	};

	const resetQuery = (next: string) => {
		setQuery(next);
		setSelectedId(null);
		setPinned(null);
		setArrivals(NO_ARRIVALS);
	};

	const changeScope = (scope: SearchScope) => {
		setExpanded(NO_GROUPS);
		resetQuery(withScopePrefix(stripScopePrefix(query), scope));
	};

	const remember = (item: PaletteItem) => {
		const next = recordPick(learning, parsed.text, item.id, Date.now());
		setLearning(next);
		writeLearning(next);
	};

	const activate = (row: PaletteRow | null) => {
		if (!row) return;
		const { item } = row;
		if (item.disabledReason) return;
		const { more } = item;
		if (more?.kind === "scope") {
			changeScope(more.scope);
			return;
		}
		if (more?.kind === "expand") {
			setExpanded((current) => new Set(current).add(more.group));
			setSelectedId(more.nextId);
			return;
		}
		if (item.run) {
			if (item.kind !== "start") remember(item);
			onClose();
			item.run();
		}
	};

	const startFromText = () => {
		if (!startInput) return;
		onClose();
		startInput.start.openDialog(startInput.text);
	};

	const cycleScope = (delta: number) => {
		const index = scopes.indexOf(parsed.scope);
		changeScope(scopes[(index + delta + scopes.length) % scopes.length] ?? "all");
	};

	const togglePreview = () => {
		setPreviewOpen((open) => {
			writePreviewOpen(!open);
			return !open;
		});
	};

	const onEscapeKeyDown = (event: KeyboardEvent) => {
		event.preventDefault();
		if (isImeComposing(event)) return;
		if (!event.isTrusted || !query) {
			onClose();
			return;
		}
		resetQuery("");
		inputRef.current?.focus();
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
		if (event.defaultPrevented || event.key === "Escape") return;
		if (event.target !== inputRef.current && event.target !== event.currentTarget) return;
		if (isImeComposing(event.nativeEvent)) {
			if (event.key === "Tab") event.preventDefault();
			return;
		}
		if (event.target !== inputRef.current) inputRef.current?.focus();
		const mod = hasPlatformModifier(event.nativeEvent);
		if (mod && event.code === "KeyK" && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			event.stopPropagation();
			onClose();
			return;
		}
		if (
			event.ctrlKey &&
			!event.shiftKey &&
			!event.altKey &&
			!event.metaKey &&
			event.code === "KeyR"
		) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (event.key === "Tab") {
			event.preventDefault();
			cycleScope(event.shiftKey ? -1 : 1);
			return;
		}
		if (mod && event.key === "Enter" && !event.altKey && !event.shiftKey) {
			event.preventDefault();
			if (!event.repeat) startFromText();
			return;
		}
		if (mod && event.code === "KeyI" && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			togglePreview();
			return;
		}
		if (event.altKey && /^Digit[1-9]$/.test(event.code)) {
			const scope = scopes[Number(event.code.slice(5)) - 1];
			if (scope) {
				event.preventDefault();
				changeScope(scope);
			}
			return;
		}
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				select(selectedIndexRef.current + 1);
				return;
			case "ArrowUp":
				event.preventDefault();
				select(selectedIndexRef.current - 1);
				return;
			case "Enter":
				event.preventDefault();
				if (!event.repeat) activate(selected);
				return;
		}
	};

	const optionId = (index: number) => `search-option-${index}`;
	const previewItem = previewOpen ? selected?.item : undefined;

	return (
		<DialogContent
			hideClose
			data-testid="search-palette"
			aria-describedby={undefined}
			className="top-[12vh] w-auto max-w-none translate-y-0 gap-0 overflow-visible p-0"
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				inputRef.current?.focus();
			}}
			onEscapeKeyDown={onEscapeKeyDown}
			onKeyDown={onKeyDown}
		>
			<DialogTitle className="sr-only">{t("search.palette.title")}</DialogTitle>
			<div
				data-testid="search-palette-body"
				data-preview={previewOpen}
				className={cn(
					"relative flex max-h-[min(76vh,720px)] flex-col rounded-lg",
					previewOpen ? "w-[min(64rem,calc(100vw-32px))]" : "w-[min(42rem,calc(100vw-32px))]",
				)}
			>
				<div className="flex h-48 shrink-0 items-center gap-8 border-border-muted border-b px-16">
					<RiSearchLine aria-hidden className="size-16 shrink-0 text-text-muted" />
					<input
						ref={inputRef}
						data-testid="search-input"
						role="combobox"
						aria-expanded="true"
						aria-controls="search-results"
						aria-autocomplete="list"
						aria-activedescendant={rows.length > 0 ? optionId(selectedIndex) : undefined}
						aria-label={t("search.palette.title")}
						autoComplete="off"
						spellCheck={false}
						value={query}
						maxLength={MAX_SEARCH_QUERY_LENGTH}
						placeholder={t(
							scopes.includes("files")
								? "search.palette.placeholderHost"
								: "search.palette.placeholder",
						)}
						onChange={(event) => resetQuery(event.target.value)}
						className="h-full min-w-0 flex-1 bg-transparent tr-text-reading text-text-default outline-none placeholder:text-text-subtle"
					/>
					<Keycaps keys={["esc"]} />
				</div>
				<ScopeChips t={t} scopes={scopes} active={parsed.scope} onSelect={changeScope} />
				{hostStatus ? (
					<p
						data-testid="search-host-status"
						data-status={hostStatus}
						className="flex shrink-0 items-center gap-8 border-border-muted border-b px-16 py-8 tr-text-metadata text-text-muted"
					>
						<RiInformationLine aria-hidden className="size-14 shrink-0" />
						{t(HOST_STATUS_LABELS[hostStatus])}
					</p>
				) : null}
				{notice ? (
					<p
						data-testid="search-notice"
						className="flex shrink-0 items-center gap-8 border-border-muted border-b px-16 py-8 tr-text-metadata text-feedback-warning"
					>
						<RiWifiOffLine aria-hidden className="size-14 shrink-0" />
						{notice}
					</p>
				) : null}
				<div className="flex min-h-0 flex-1">
					<div
						ref={listRef}
						id="search-results"
						role="listbox"
						aria-label={t("search.palette.results")}
						className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 pt-4 pb-8"
					>
						{rows.length === 0 ? (
							<p
								data-testid="search-empty"
								className="px-8 py-24 text-center tr-text-ui text-text-muted"
							>
								{query.trim() ? t("search.palette.noMatches") : t("search.palette.nothingYet")}
							</p>
						) : (
							<Sections
								sections={sections}
								rows={rows}
								selectedIndex={selectedIndex}
								optionId={optionId}
								onHover={(index) => select(index)}
								onActivate={(row) => activate(row)}
							/>
						)}
					</div>
					{previewItem ? (
						<Preview t={t} item={previewItem} previews={previews} host={host} />
					) : null}
				</div>
				<footer className="flex h-32 shrink-0 items-center gap-12 overflow-hidden border-border-muted border-t px-12 tr-text-metadata text-text-subtle">
					<Hint keys={["↑", "↓"]} label={t("search.hint.select")} />
					<Hint keys={["↵"]} label={t(enterLabel(selected?.item))} />
					<Hint keys={["Tab"]} label={t("search.hint.scope")} />
					{startInput ? (
						<Hint keys={shortcutKeys({ key: "↵", mod: true })} label={t("search.hint.start")} />
					) : null}
					{hostState.pending ? (
						<span
							data-testid="search-host-pending"
							className="flex shrink-0 items-center gap-4 text-text-muted"
						>
							<RunningIcon className="size-12" />
							{t("search.palette.searching")}
						</span>
					) : null}
					<Hint keys={["esc"]} label={t(query ? "search.hint.clear" : "search.hint.close")} />
					<span className="flex-1" />
					<Button
						variant="ghost"
						size="s"
						iconLeft={RiSideBarLine}
						selected={previewOpen}
						aria-pressed={previewOpen}
						tabIndex={-1}
						data-testid="search-preview-toggle"
						data-active={previewOpen}
						onMouseDown={keepInputFocus}
						onClick={togglePreview}
					>
						{t("search.palette.preview")}
						<Keycaps keys={shortcutKeys({ key: "I", mod: true })} />
					</Button>
				</footer>
				<p role="status" aria-live="polite" className="sr-only">
					{t("search.palette.resultCount", {
						count: rows.filter((row) => row.item.kind !== "start").length,
					})}
					{hostState.pending ? ` ${t("search.palette.searching")}` : ""}
					{hostStatus ? ` ${t(HOST_STATUS_LABELS[hostStatus])}` : ""}
				</p>
			</div>
		</DialogContent>
	);
}

const NO_GROUPS: ReadonlySet<string> = new Set();
const PREVIEW_SETTLE_MS = 150;

function useSettled(key: string, ms: number): boolean {
	const [settled, setSettled] = useState<string | null>(null);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(key), ms);
		return () => clearTimeout(timer);
	}, [key, ms]);
	return settled === key;
}

function keepInputFocus(event: ReactMouseEvent): void {
	event.preventDefault();
}

function enterLabel(item: PaletteItem | undefined): MessageKey {
	if (!item) return "search.hint.open";
	if (item.kind === "command") return "search.hint.run";
	if (item.kind === "start") return "search.hint.start";
	return "search.hint.open";
}

function Keycaps({ keys }: { keys: readonly string[] }) {
	return (
		<span className="flex shrink-0 items-center gap-2">
			{keys.map((key) => (
				<kbd
					key={key}
					className="inline-flex h-16 min-w-16 items-center justify-center rounded-xs border border-border-default px-4 tr-text-metadata text-text-muted"
				>
					{key}
				</kbd>
			))}
		</span>
	);
}

function Hint({ keys, label }: { keys: readonly string[]; label: string }) {
	return (
		<span className="flex shrink-0 items-center gap-4">
			<Keycaps keys={keys} />
			{label}
		</span>
	);
}

function ScopeChips({
	t,
	scopes,
	active,
	onSelect,
}: {
	t: Translator;
	scopes: readonly SearchScope[];
	active: SearchScope;
	onSelect: (scope: SearchScope) => void;
}) {
	return (
		<div className="flex shrink-0 items-center gap-8 border-border-muted border-b px-12 py-8">
			{scopes.map((scope) => (
				<Button
					key={scope}
					variant="outline"
					size="m"
					selected={scope === active}
					aria-pressed={scope === active}
					tabIndex={-1}
					data-testid="search-chip"
					data-scope={scope}
					data-active={scope === active}
					onMouseDown={keepInputFocus}
					onClick={() => onSelect(scope)}
				>
					{t(SCOPE_LABELS[scope])}
					{scope === "all" ? null : (
						<span className="tr-code-text-small text-text-subtle">{SCOPE_PREFIX[scope]}</span>
					)}
				</Button>
			))}
		</div>
	);
}

function Sections({
	sections,
	rows,
	selectedIndex,
	optionId,
	onHover,
	onActivate,
}: {
	sections: readonly PaletteSection[];
	rows: readonly PaletteRow[];
	selectedIndex: number;
	optionId: (index: number) => string;
	onHover: (index: number) => void;
	onActivate: (row: PaletteRow) => void;
}) {
	const indexOf = new Map(rows.map((row, index) => [row, index]));
	return sections.map((section) => (
		<fieldset
			key={section.id}
			data-testid="search-section"
			data-section={section.id}
			aria-labelledby={`search-group-${section.id}`}
			className="m-0 min-w-0 border-0 p-0"
		>
			<div
				id={`search-group-${section.id}`}
				role="presentation"
				className="flex items-center gap-8 px-8 pt-12 pb-4 tr-text-eyebrow text-text-subtle"
			>
				<span className="flex-1">{section.title}</span>
				{section.meta ? <span className="tr-text-metadata normal-case">{section.meta}</span> : null}
			</div>
			{section.items.map((row) => {
				const index = indexOf.get(row) ?? 0;
				return (
					<Row
						key={row.item.id}
						row={row}
						id={optionId(index)}
						index={index}
						selected={index === selectedIndex}
						onHover={() => onHover(index)}
						onActivate={() => onActivate(row)}
					/>
				);
			})}
		</fieldset>
	));
}

function highlight(
	text: string,
	ranges: readonly (readonly [number, number])[] | undefined,
): ReactNode {
	if (!ranges || ranges.length === 0) return text;
	const parts: ReactNode[] = [];
	let cursor = 0;
	for (const [start, end] of ranges) {
		if (start > cursor) parts.push(text.slice(cursor, start));
		parts.push(
			<mark key={start} className="rounded-xs bg-primary-soft text-text-default">
				{text.slice(start, end)}
			</mark>,
		);
		cursor = end;
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return parts;
}

function Row({
	row,
	id,
	index,
	selected,
	onHover,
	onActivate,
}: {
	row: PaletteRow;
	id: string;
	index: number;
	selected: boolean;
	onHover: () => void;
	onActivate: () => void;
}) {
	const { item } = row;
	const Icon = item.icon;
	return (
		<div
			id={id}
			role="option"
			tabIndex={-1}
			aria-selected={selected}
			aria-disabled={item.disabledReason ? true : undefined}
			data-testid="search-row"
			data-index={index}
			data-item-id={item.id}
			data-kind={item.kind}
			data-top={row.top === true}
			onMouseMove={selected ? undefined : onHover}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onActivate}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onActivate();
				}
			}}
			className={cn(
				"group flex cursor-pointer items-center gap-8 rounded-sm px-8 py-4",
				item.subtitle ? "min-h-40" : "min-h-32",
				row.top ? "min-h-48" : undefined,
				selected ? "bg-control-bg-selected" : undefined,
				item.disabledReason ? "cursor-default" : undefined,
			)}
		>
			{item.running ? (
				<RunningIcon className="size-16 shrink-0 text-text-muted group-aria-selected:text-primary" />
			) : (
				<Icon
					aria-hidden
					className={cn(
						"size-16 shrink-0",
						item.disabledReason
							? "text-text-disabled"
							: "text-text-muted group-aria-selected:text-primary",
					)}
				/>
			)}
			<span className="flex min-w-0 flex-1 flex-col">
				<span
					data-title-source={item.titleSource}
					title={item.titleTooltip}
					className={cn(
						"truncate",
						row.top ? "tr-title-section" : "tr-text-ui",
						item.disabledReason ? "text-text-disabled" : "text-text-default",
					)}
				>
					{highlight(item.title, row.ranges.title)}
				</span>
				{item.subtitle ? (
					<span className="truncate tr-text-metadata text-text-subtle">
						{highlight(item.subtitle, row.ranges.subtitle)}
					</span>
				) : null}
			</span>
			<span className="flex shrink-0 items-center gap-8 tr-text-metadata text-text-subtle">
				{item.disabledReason ? <span>{item.disabledReason}</span> : null}
				{item.badge ? (
					<span className="rounded-xs border border-border-muted px-4">{item.badge}</span>
				) : null}
				{item.attention && item.attention !== "running" ? <AttentionDot /> : null}
				{item.shortcut ? <Keycaps keys={shortcutKeys(item.shortcut)} /> : null}
				{selected && !item.disabledReason ? (
					<RiCornerDownLeftLine aria-hidden className="size-14 text-text-muted" />
				) : null}
			</span>
		</div>
	);
}

function Preview({
	t,
	item,
	previews,
	host,
}: {
	t: Translator;
	item: PaletteItem;
	previews: HostPreviewLoader;
	host: PaletteHost | undefined;
}) {
	const preview = item.preview?.() ?? null;
	const Icon = item.icon;
	return (
		<aside
			data-testid="search-preview"
			data-kind={item.file ? "file" : item.previewTarget ? "transcript" : "card"}
			className="hidden w-[40%] shrink-0 flex-col overflow-y-auto border-border-muted border-l px-16 py-16 md:flex"
		>
			{item.file && host ? (
				<FilePreview t={t} item={item} file={item.file} host={host} />
			) : item.previewTarget ? (
				<HostPreview t={t} item={item} target={item.previewTarget} previews={previews} />
			) : preview ? (
				<>
					<div className="flex items-center gap-8 tr-title-card text-text-default">
						<Icon aria-hidden className="size-16 shrink-0 text-primary" />
						<span className="min-w-0 truncate">{preview.title}</span>
					</div>
					{preview.subtitle ? (
						<p className="mt-4 truncate tr-text-metadata text-text-subtle">{preview.subtitle}</p>
					) : null}
					{preview.fields.length > 0 ? (
						<dl className="mt-12 grid grid-cols-[auto_1fr] gap-x-12 gap-y-4 tr-text-ui">
							{preview.fields.map(([label, value]) => (
								<div key={label} className="contents">
									<dt className="text-text-subtle">{label}</dt>
									<dd className="min-w-0 truncate text-text-default">{value}</dd>
								</div>
							))}
						</dl>
					) : null}
				</>
			) : (
				<p className="tr-text-ui text-text-subtle">{t("search.palette.noPreview")}</p>
			)}
		</aside>
	);
}

function PreviewHeading({ item, title }: { item: PaletteItem; title?: string }) {
	const Icon = item.icon;
	return (
		<>
			<div className="flex items-center gap-8 tr-title-card text-text-default">
				<Icon aria-hidden className="size-16 shrink-0 text-primary" />
				<span className="min-w-0 truncate">{title || item.title}</span>
			</div>
			{item.subtitle ? (
				<p className="mt-4 truncate tr-text-metadata text-text-subtle">{item.subtitle}</p>
			) : null}
		</>
	);
}

function FilePreview({
	t,
	item,
	file,
	host,
}: {
	t: Translator;
	item: PaletteItem;
	file: PaletteFile;
	host: PaletteHost;
}) {
	const settled = useSettled(`${file.workspaceId}:${file.path}`, PREVIEW_SETTLE_MS);
	const tooLarge = file.size !== undefined && file.size > MAX_SEARCH_PREVIEW_BYTES;
	return (
		<div
			data-testid="search-file-preview"
			data-state={tooLarge ? "too-large" : settled ? "ready" : "loading"}
			className="flex min-h-0 flex-1 flex-col"
		>
			<PreviewHeading item={item} />
			{tooLarge ? (
				<p className="mt-12 tr-text-ui text-text-subtle">{t("search.palette.previewTooLarge")}</p>
			) : settled ? (
				<div className="mt-12 min-h-0 flex-1 overflow-auto rounded-sm border border-border-muted">
					{host.renderFilePreview(file)}
				</div>
			) : (
				<p className="mt-12 tr-text-ui text-text-subtle">{t("search.palette.previewLoading")}</p>
			)}
		</div>
	);
}

function HostPreview({
	t,
	item,
	target,
	previews,
}: {
	t: Translator;
	item: PaletteItem;
	target: SearchPreviewTarget;
	previews: HostPreviewLoader;
}) {
	const [result, setResult] = useState<SearchPreviewResult | null>(null);
	const key = JSON.stringify(target);
	useEffect(() => {
		let current = true;
		setResult(null);
		const timer = setTimeout(() => {
			void previews.load(JSON.parse(key) as SearchPreviewTarget).then((loaded) => {
				if (current) setResult(loaded);
			});
		}, PREVIEW_SETTLE_MS);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [key, previews]);
	return (
		<div data-testid="search-host-preview" data-state={result?.kind ?? "loading"}>
			<PreviewHeading item={item} title={result?.kind === "transcript" ? result.title : ""} />
			{result === null ? (
				<p className="mt-12 tr-text-ui text-text-subtle">{t("search.palette.previewLoading")}</p>
			) : result.kind === "unavailable" ? (
				<p className="mt-12 tr-text-ui text-text-subtle">{t("search.palette.noPreview")}</p>
			) : (
				<ol className="mt-12 flex flex-col gap-8">
					{result.messages.map((message) => (
						<li
							key={message.messageIndex}
							data-focus={message.focus}
							className={cn(
								"rounded-sm px-8 py-4 tr-text-ui",
								message.focus ? "bg-control-bg-selected text-text-default" : "text-text-muted",
							)}
						>
							<span className="block tr-text-eyebrow text-text-subtle">
								{t(
									message.role === "user"
										? "search.preview.roleUser"
										: "search.preview.roleAssistant",
								)}
							</span>
							<span className="whitespace-pre-wrap break-words">{message.text}</span>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}
