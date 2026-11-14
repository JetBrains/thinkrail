import {
	RiCornerDownLeftLine,
	RiErrorWarningLine,
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
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import {
	Fragment,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useEffect,
	useId,
	useInsertionEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { shortcutKeys } from "../commands";
import { AttentionDot } from "../components/AttentionDot";
import { Keycaps, KeyHint } from "../components/Keycaps";
import { highlightRanges } from "../components/MatchHighlight";
import { RunningIcon } from "../components/RunningIcon";
import { hasPlatformModifier, useMediaQuery } from "../lib";
import { selectHostReachable, useAppStore } from "../store";
import { hostItems, hostOverflow } from "./hostItems";
import {
	createHostPreviewLoader,
	type HostPreviewLoader,
	type HostSearchReason,
	hostSearchReasons,
	useHostSearch,
} from "./hostSearch";
import { recordPick } from "./learning";
import type {
	PaletteAsk,
	PaletteFile,
	PaletteItem,
	PaletteRow,
	PaletteSection,
	PaletteStart,
} from "./model";
import { currentPlaceIds } from "./places";
import { readLearning, readPreviewOpen, writeLearning, writePreviewOpen } from "./preferences";
import {
	parseSearchQuery,
	SCOPE_PREFIX,
	type SearchScope,
	scopeKinds,
	stripScopePrefix,
	withScopePrefix,
} from "./query";
import { scopeChordIndex } from "./scopeChord";
import {
	askEligible,
	flattenRows,
	groupSections,
	rankSections,
	startEligible,
	startPrompt,
} from "./sections";

const WIDE_VIEWPORT = "(min-width: 48rem)";
const SPINNER_DELAY_MS = 200;

function reasonText(t: Translator, reason: HostSearchReason): string {
	switch (reason.kind) {
		case "failed":
			return t("search.palette.hostFailed");
		case "indexing":
			return t("search.palette.hostIndexing");
		case "time":
			return t("search.palette.hostOutOfTime");
		case "fileList":
			return t("search.palette.hostFileList", { files: reason.files.toLocaleString(localeOf(t)) });
	}
}

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

export interface PaletteNotice {
	readonly kind: "offline" | "info";
	readonly text: string;
}

export interface SearchPaletteProps {
	readonly onClose: () => void;
	readonly rootItems: readonly PaletteItem[];
	readonly waiting: readonly PaletteItem[];
	readonly actions: readonly PaletteItem[];
	readonly scopes: readonly SearchScope[];
	readonly host?: PaletteHost;
	readonly start?: PaletteStart;
	readonly ask?: PaletteAsk;
	readonly notice?: PaletteNotice;
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
	ask,
	notice,
}: SearchPaletteProps) {
	const t = useT();
	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_GROUPS);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [previewOpen, setPreviewOpen] = useState(readPreviewOpen);
	const wide = useMediaQuery(WIDE_VIEWPORT);
	const reachable = useAppStore(selectHostReachable);
	const generation = useAppStore((s) => s.welcomeGeneration);
	const [learning, setLearning] = useState(readLearning);
	const [nowMs] = useState(Date.now);
	const [currentPlaces] = useState(() => currentPlaceIds(useAppStore.getState()));
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const pickedRef = useRef(false);

	const parsed = useMemo(() => parseSearchQuery(query, scopes), [query, scopes]);
	const hostEnabled = host !== undefined;
	const hostProjectId = host?.context.projectId;
	const hostWorkspaceId = host?.context.workspaceId;
	const hostText = parsed.terms.length > 0 ? parsed.text : "";
	const hostInput = useMemo(
		() => ({
			enabled: hostEnabled,
			text: hostText,
			kinds: scopeKinds(parsed.scope),
			context: {
				...(hostProjectId ? { projectId: hostProjectId } : {}),
				...(hostWorkspaceId ? { workspaceId: hostWorkspaceId } : {}),
			},
			...(parsed.scope === "all" ? {} : { limit: MAX_SEARCH_GROUP_LIMIT }),
		}),
		[hostEnabled, hostProjectId, hostWorkspaceId, hostText, parsed.scope],
	);
	const { state: hostState, observe } = useHostSearch(hostInput);
	const [previews] = useState(createHostPreviewLoader);
	const late = hostState.arrivals.late;
	const offlineReason = reachable ? undefined : t("search.palette.offlineReason");
	const hostRows = useMemo(() => {
		if (!host || !hostState.groups || hostState.groups.length === 0) return [];
		const context = {
			t,
			openHit: host.openHit,
			projectName: host.projectName,
			workspaceName: host.workspaceName,
			late,
			staleTerms: hostState.stale ? parsed.terms : null,
			...(offlineReason ? { disabledReason: offlineReason } : {}),
		};
		return hostItems(context, hostState.groups);
	}, [host, hostState.groups, hostState.stale, parsed.terms, t, late, offlineReason]);
	const allItems = useMemo(() => [...rootItems, ...hostRows], [rootItems, hostRows]);
	const overflow = useMemo(
		() => (hostState.groups && !hostState.stale ? hostOverflow(hostState.groups) : {}),
		[hostState.groups, hostState.stale],
	);
	const reasons = useMemo(() => hostSearchReasons(hostState), [hostState]);
	const startText = startEligible(parsed) ? startPrompt(parsed.raw) : "";
	const startInput = useMemo(
		() => (start && startText ? { start, text: startText } : undefined),
		[start, startText],
	);
	const askText = askEligible(parsed) ? startPrompt(parsed.raw) : "";
	const askInput = useMemo(
		() =>
			ask && askText
				? { ask, text: askText, ...(offlineReason ? { disabledReason: offlineReason } : {}) }
				: undefined,
		[ask, askText, offlineReason],
	);
	const ranked = useMemo(
		() => rankSections({ parsed, rootItems: allItems, learning, nowMs }),
		[parsed, allItems, learning, nowMs],
	);
	const sections = useMemo(
		() =>
			groupSections(ranked, {
				t,
				parsed,
				hostOverflow: overflow,
				...(startInput ? { start: startInput } : {}),
				...(askInput ? { ask: askInput } : {}),
				rootItems: allItems,
				waiting,
				actions: emptyActions,
				expanded,
				learning,
				nowMs,
				keep: selectedId,
				currentPlaces,
			}),
		[
			ranked,
			t,
			parsed,
			overflow,
			startInput,
			askInput,
			allItems,
			waiting,
			emptyActions,
			expanded,
			learning,
			nowMs,
			selectedId,
			currentPlaces,
		],
	);
	const rows = useMemo(() => flattenRows(sections), [sections]);
	useLayoutEffect(() => {
		observe(new Set(rows.map((row) => row.item.id)), selectedId !== null);
	}, [observe, rows, selectedId]);
	const selectedIndex = Math.max(
		0,
		rows.findIndex((row) => row.item.id === selectedId),
	);
	const selected = rows[selectedIndex] ?? null;
	const selectedRowId = selected?.item.id;

	const selectedIndexRef = useRef(selectedIndex);
	useInsertionEffect(() => {
		selectedIndexRef.current = selectedIndex;
	});
	useEffect(() => {
		if (selectedRowId === undefined) return;
		listRef.current
			?.querySelector(`[data-index="${selectedIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex, selectedRowId]);

	const select = (index: number) => {
		const row = rows[(index + rows.length) % rows.length];
		if (!row) return;
		setSelectedId(row.item.id);
	};

	const resetQuery = (next: string) => {
		setQuery(next);
		setSelectedId(null);
	};

	const changeScope = (scope: SearchScope) => {
		setExpanded(NO_GROUPS);
		resetQuery(withScopePrefix(stripScopePrefix(query), scope));
	};

	const remember = (item: PaletteItem) => {
		const next = recordPick(readLearning(), parsed.text, item.id, Date.now(), currentPlaces);
		setLearning(next);
		writeLearning(next);
	};

	const startFromText = () => {
		if (!startInput) return;
		pickedRef.current = startInput.start.openDialog(startInput.text);
		onClose();
	};

	const askFromText = () => {
		if (!askInput || askInput.disabledReason) return;
		pickedRef.current = true;
		onClose();
		askInput.ask.ask(askInput.text);
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
		if (item.kind === "start") {
			startFromText();
			return;
		}
		if (item.kind === "ask") {
			askFromText();
			return;
		}
		if (item.run) {
			pickedRef.current = true;
			remember(item);
			onClose();
			item.run();
		}
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
		const fromFrame = event.target === event.currentTarget;
		if (event.target !== inputRef.current && !fromFrame) return;
		if (isImeComposing(event.nativeEvent)) {
			if (event.key === "Tab") event.preventDefault();
			return;
		}
		const claim = () => {
			event.preventDefault();
			if (fromFrame) inputRef.current?.focus();
		};
		const mod = hasPlatformModifier(event.nativeEvent);
		if (mod && event.code === "KeyK" && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			event.stopPropagation();
			onClose();
			return;
		}
		if (event.key === "Tab") {
			claim();
			cycleScope(event.shiftKey ? -1 : 1);
			return;
		}
		if (mod && event.key === "Enter" && !event.altKey && !event.shiftKey) {
			claim();
			if (!event.repeat) startFromText();
			return;
		}
		if (askInput && event.altKey && event.key === "Enter" && !mod && !event.shiftKey) {
			claim();
			if (!event.repeat) askFromText();
			return;
		}
		if (mod && event.code === "KeyI" && !event.shiftKey && !event.altKey) {
			claim();
			if (wide) togglePreview();
			return;
		}
		const chord = scopeChordIndex(event.nativeEvent);
		if (chord !== null) {
			const scope = scopes[chord];
			if (scope) {
				claim();
				changeScope(scope);
			}
			return;
		}
		switch (event.key) {
			case "ArrowDown":
				claim();
				select(selectedIndexRef.current + 1);
				return;
			case "ArrowUp":
				claim();
				select(selectedIndexRef.current - 1);
				return;
			case "Enter":
				claim();
				if (!event.repeat) activate(selected);
				return;
		}
		if (fromFrame && !event.ctrlKey && !event.metaKey && !MODIFIER_KEYS.has(event.key)) {
			inputRef.current?.focus();
		}
	};

	const optionId = (index: number) => `search-option-${index}`;
	const showPreview = previewOpen && wide;
	const previewItem = showPreview ? selected?.item : undefined;
	const reasonsId = useId();

	return (
		<DialogContent
			hideClose
			data-testid="search-palette"
			aria-describedby={undefined}
			className="top-[12vh] w-auto max-w-none translate-y-0 gap-0 overflow-visible p-0"
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				const previous = document.activeElement;
				returnFocusRef.current = previous instanceof HTMLElement ? previous : null;
				inputRef.current?.focus();
			}}
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				const target = returnFocusRef.current;
				if (!pickedRef.current && target?.isConnected) target.focus({ preventScroll: true });
			}}
			onEscapeKeyDown={onEscapeKeyDown}
			onKeyDown={onKeyDown}
		>
			<DialogTitle className="sr-only">{t("search.palette.title")}</DialogTitle>
			<div
				data-testid="search-palette-body"
				data-preview={showPreview}
				className={cn(
					"relative flex flex-col rounded-lg",
					showPreview
						? "h-[min(76vh,720px)] w-[min(64rem,calc(100vw-32px))]"
						: "max-h-[min(76vh,720px)] w-[min(42rem,calc(100vw-32px))]",
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
						aria-describedby={reasons.length > 0 ? reasonsId : undefined}
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
					<SearchStatus
						t={t}
						pendingKey={
							hostState.pending ? `${generation}:${hostInput.text}:${parsed.scope}` : null
						}
						reasons={reasons}
					/>
					<Keycaps keys={["esc"]} />
				</div>
				{reasons.length > 0 ? (
					<p id={reasonsId} className="sr-only">
						{reasons.map((reason) => reasonText(t, reason)).join(" ")}
					</p>
				) : null}
				<ScopeChips t={t} scopes={scopes} active={parsed.scope} onSelect={changeScope} />
				{notice ? (
					<p
						data-testid="search-notice"
						data-kind={notice.kind}
						className={cn(
							"flex shrink-0 items-center gap-8 wrap-anywhere border-border-muted border-b px-16 py-8 tr-text-metadata",
							notice.kind === "offline" ? "text-feedback-warning" : "text-text-muted",
						)}
					>
						{notice.kind === "offline" ? (
							<RiWifiOffLine aria-hidden className="size-14 shrink-0" />
						) : (
							<RiInformationLine aria-hidden className="size-14 shrink-0" />
						)}
						{notice.text}
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
				<footer className="flex h-32 shrink-0 items-center gap-12 border-border-muted border-t px-12 tr-text-metadata text-text-subtle">
					<div className="@container flex h-16 min-w-0 flex-1 flex-wrap gap-x-12 overflow-hidden">
						<KeyHint keys={["↑", "↓"]} label={t("search.hint.select")} />
						<KeyHint keys={["↵"]} label={t(enterLabel(selected?.item))} />
						<KeyHint keys={["Tab"]} label={t("search.hint.scope")} />
						{startInput ? (
							<KeyHint
								keys={shortcutKeys({ key: "↵", mod: true })}
								label={t("search.hint.start")}
							/>
						) : null}
						{askInput && !askInput.disabledReason && selected?.item.kind !== "ask" ? (
							<KeyHint keys={shortcutKeys({ key: "↵", alt: true })} label={t("search.hint.ask")} />
						) : null}
						<KeyHint keys={["esc"]} label={t(query ? "search.hint.clear" : "search.hint.close")} />
					</div>
					{wide ? (
						<Button
							variant="ghost"
							size="s"
							iconLeft={RiSideBarLine}
							selected={previewOpen}
							aria-pressed={previewOpen}
							tabIndex={-1}
							className="shrink-0"
							data-testid="search-preview-toggle"
							data-active={previewOpen}
							onMouseDown={keepInputFocus}
							onClick={togglePreview}
						>
							{t("search.palette.preview")}
							<Keycaps keys={shortcutKeys({ key: "I", mod: true })} />
						</Button>
					) : null}
				</footer>
				<p role="status" aria-live="polite" className="sr-only">
					{t("search.palette.resultCount", {
						count: rows.filter((row) => row.item.kind !== "start").length,
					})}
					{hostState.pending ? ` ${t("search.palette.searching")}` : ""}
					{reasons.map((reason) => ` ${reasonText(t, reason)}`).join("")}
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

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
	"Alt",
	"AltGraph",
	"CapsLock",
	"Control",
	"Fn",
	"Meta",
	"OS",
	"Shift",
]);

function keepInputFocus(event: ReactMouseEvent): void {
	event.preventDefault();
}

function SearchStatus({
	t,
	pendingKey,
	reasons,
}: {
	t: Translator;
	pendingKey: string | null;
	reasons: readonly HostSearchReason[];
}) {
	const spinning = useSettled(pendingKey ?? "", SPINNER_DELAY_MS) && pendingKey !== null;
	if (spinning) {
		return (
			<span data-testid="search-host-pending" className="flex shrink-0 text-text-muted">
				<RunningIcon className="size-16" />
			</span>
		);
	}
	return reasons.length > 0 ? <StatusMark t={t} reasons={reasons} /> : null;
}

function StatusMark({ t, reasons }: { t: Translator; reasons: readonly HostSearchReason[] }) {
	const [open, setOpen] = useState(false);
	const pointer = useRef("mouse");
	const openAtPress = useRef(false);
	return (
		<Tooltip open={open} onOpenChange={setOpen}>
			<TooltipTrigger asChild>
				<button
					type="button"
					tabIndex={-1}
					data-testid="search-host-status"
					data-reasons={reasons.map((reason) => reason.kind).join(" ")}
					aria-label={t("search.palette.incomplete")}
					className="flex shrink-0 rounded-xs text-feedback-warning"
					onPointerDown={(event) => {
						event.preventDefault();
						pointer.current = event.pointerType;
						openAtPress.current = open;
					}}
					onMouseDown={keepInputFocus}
					onClick={(event) => {
						event.preventDefault();
						if (pointer.current !== "mouse") setOpen(!openAtPress.current);
					}}
				>
					<RiErrorWarningLine aria-hidden className="size-16" />
				</button>
			</TooltipTrigger>
			<TooltipContent
				side="bottom"
				align="end"
				data-testid="search-host-status-reasons"
				className="flex max-w-320 flex-col gap-4"
				onEscapeKeyDown={(event) => {
					if (isImeComposing(event)) event.preventDefault();
				}}
			>
				{reasons.map((reason) => (
					<p key={reason.kind}>{reasonText(t, reason)}</p>
				))}
			</TooltipContent>
		</Tooltip>
	);
}

function enterLabel(item: PaletteItem | undefined): MessageKey {
	if (!item) return "search.hint.open";
	if (item.kind === "command") return "search.hint.run";
	if (item.kind === "start") return "search.hint.start";
	if (item.kind === "ask") return "search.hint.ask";
	return "search.hint.open";
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
		<div className="flex shrink-0 flex-wrap items-center gap-8 border-border-muted border-b px-12 py-8">
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
				<span className="min-w-0 flex-1 truncate">{section.title}</span>
				{section.meta ? (
					<span className="min-w-0 truncate tr-text-metadata normal-case">{section.meta}</span>
				) : null}
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
					<RowTitle title={item.title} lead={item.titleLead ?? 0} ranges={row.ranges.title} />
				</span>
				{item.subtitle ? (
					<span
						data-testid="search-row-subtitle"
						className="truncate tr-text-metadata text-text-subtle"
					>
						{highlightSpans(item.subtitle, row.ranges.subtitle, item.subtitleEmphasis)}
					</span>
				) : null}
			</span>
			<span className="flex min-w-0 max-w-[50%] items-center gap-8 tr-text-metadata text-text-subtle">
				{item.disabledReason ? <span className="truncate">{item.disabledReason}</span> : null}
				{item.badge ? (
					<span className="truncate rounded-xs border border-border-muted px-4">{item.badge}</span>
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

function RowTitle({
	title,
	lead,
	ranges = [],
}: {
	title: string;
	lead: number;
	ranges: readonly (readonly [number, number])[] | undefined;
}): ReactNode {
	return highlightSpans(title, ranges, lead > 0 ? [[0, lead]] : undefined);
}

type Span = readonly [number, number];

function highlightSpans(
	text: string,
	ranges: readonly Span[] | undefined,
	spans: readonly Span[] | undefined,
): ReactNode {
	if (!spans?.length) return highlightRanges(text, ranges);
	const cuts = [...new Set([0, text.length, ...spans.flat()])]
		.filter((cut) => cut >= 0 && cut <= text.length)
		.sort((a, b) => a - b);
	return cuts.slice(1).map((end, index) => {
		const start = cuts[index] ?? 0;
		const inner = (ranges ?? [])
			.filter(([from, to]) => from < end && to > start)
			.map(([from, to]): Span => [Math.max(from, start) - start, Math.min(to, end) - start]);
		const content = highlightRanges(text.slice(start, end), inner);
		const marked = spans.some(([from, to]) => from <= start && end <= to);
		return marked ? (
			<span key={start} className="text-text-muted">
				{content}
			</span>
		) : (
			<Fragment key={start}>{content}</Fragment>
		);
	});
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
	return (
		<aside
			data-testid="search-preview"
			data-kind={item.file ? "file" : item.previewTarget ? "transcript" : "card"}
			className="flex w-[40%] shrink-0 flex-col overflow-y-auto border-border-muted border-l px-16 py-16"
		>
			{item.file && host ? (
				<FilePreview t={t} item={item} file={item.file} host={host} />
			) : item.previewTarget ? (
				<HostPreview t={t} item={item} target={item.previewTarget} previews={previews} />
			) : (
				<PreviewCard t={t} item={item} />
			)}
		</aside>
	);
}

function PreviewCard({ t, item }: { t: Translator; item: PaletteItem }) {
	const preview = item.preview?.() ?? null;
	if (!preview)
		return <p className="tr-text-ui text-text-subtle">{t("search.palette.noPreview")}</p>;
	const Icon = item.icon;
	return (
		<>
			<div className="flex items-center gap-8 tr-title-card text-text-default">
				<Icon aria-hidden className="size-16 shrink-0 text-primary" />
				<span className="min-w-0 truncate">{preview.title}</span>
			</div>
			{preview.subtitle ? (
				<p className="mt-4 truncate tr-text-metadata text-text-subtle">{preview.subtitle}</p>
			) : null}
			{preview.fields.length > 0 ? (
				<dl className="mt-12 grid grid-cols-[auto_minmax(0,1fr)] gap-x-12 gap-y-4 tr-text-ui">
					{preview.fields.map(([label, value]) => (
						<div key={label} className="contents">
							<dt className="wrap-anywhere text-text-subtle">{label}</dt>
							<dd className="min-w-0 truncate text-text-default">{value}</dd>
						</div>
					))}
				</dl>
			) : null}
		</>
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
	const generation = useAppStore((s) => s.welcomeGeneration);
	const reachable = useAppStore(selectHostReachable);
	const { sessionId, messageIndex, anchorText } = target;
	const targetKey = `${sessionId}:${messageIndex ?? ""}:${anchorText ?? ""}`;
	const settled = useSettled(targetKey, PREVIEW_SETTLE_MS);
	const key = `${generation}:${targetKey}`;
	const [loaded, setLoaded] = useState<{ target: string; result: SearchPreviewResult } | null>(
		null,
	);
	useEffect(() => {
		if (!settled || !reachable) return;
		let current = true;
		void previews
			.load({
				kind: "chat",
				sessionId,
				...(messageIndex === undefined ? {} : { messageIndex }),
				...(anchorText === undefined ? {} : { anchorText }),
			})
			.then((result) => {
				if (current) setLoaded({ target: targetKey, result });
			});
		return () => {
			current = false;
		};
	}, [settled, reachable, previews, key, targetKey, sessionId, messageIndex, anchorText]);
	const result = loaded?.target === targetKey ? loaded.result : null;
	if (result?.kind === "unavailable" || (result === null && !reachable)) {
		return (
			<div data-testid="search-host-preview" data-state={result ? "unavailable" : "offline"}>
				{item.preview || result ? (
					<PreviewCard t={t} item={item} />
				) : (
					<p className="tr-text-ui text-text-subtle">{t("search.palette.previewOffline")}</p>
				)}
			</div>
		);
	}
	return (
		<div data-testid="search-host-preview" data-state={result?.kind ?? "loading"}>
			<PreviewHeading item={item} title={result?.kind === "transcript" ? result.title : ""} />
			{result === null ? (
				<p className="mt-12 tr-text-ui text-text-subtle">{t("search.palette.previewLoading")}</p>
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
