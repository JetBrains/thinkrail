import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowLeftRightLine as Swap,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import type { AskUserQuestionItem } from "@thinkrail/pi-ask-user-question/core";
import {
	type HtmlViewport,
	HtmlViewportSwitch,
	ResourcePreview,
	useOptionalResourceHost,
	useResourceScope,
} from "@thinkrail/resource-renderers";
import { Button, IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, type RefObject, useRef, useState } from "react";
import {
	COMPARE_VIEWS,
	type CompareItem,
	type CompareState,
	type CompareView,
	compareItems,
	compareJumpIndex,
	compareStart,
	flipCompare,
	hasHtmlFile,
	pairsVisually,
	setCompareLeft,
	setCompareView,
	showCompareItem,
	swapCompare,
} from "./compareModel";
import { FileUnavailable, PreviewMarkdown } from "./previews";

export interface CompareOverlayProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	question: AskUserQuestionItem;
	start: number;
	chosen: string | null;
	onChoose?: ((label: string, optionIndex: number) => void) | undefined;
	onClosed?: (() => boolean) | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
}

const VIEW_LABELS = {
	single: "tools.ask.compare.single",
	pair: "tools.ask.compare.pair",
	grid: "tools.ask.compare.grid",
} as const;

let lastWidth: HtmlViewport = "desktop";

const OWN_KEYS =
	'input, textarea, select, [contenteditable="true"], [role="slider"], [role="menu"]';

function ownsKeys(target: EventTarget): boolean {
	return target instanceof Element && target.closest(OWN_KEYS) !== null;
}

export function CompareOverlay({ open, onOpenChange, onClosed, ...props }: CompareOverlayProps) {
	const rootRef = useRef<HTMLElement>(null);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-testid="ask-compare"
				aria-describedby={undefined}
				className="h-[90vh] w-[95vw] max-w-[95vw] gap-0 overflow-hidden p-12"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					rootRef.current?.focus({ preventScroll: true });
				}}
				onCloseAutoFocus={(event) => {
					if (onClosed?.()) event.preventDefault();
				}}
				onFocus={(event) => {
					if (event.target === event.currentTarget) rootRef.current?.focus({ preventScroll: true });
				}}
			>
				<CompareBody {...props} rootRef={rootRef} />
			</DialogContent>
		</Dialog>
	);
}

function CompareBody({
	question,
	start,
	chosen,
	onChoose,
	onOpenFile,
	rootRef,
}: Omit<CompareOverlayProps, "open" | "onOpenChange" | "onClosed"> & {
	rootRef: RefObject<HTMLElement | null>;
}) {
	const t = useT();
	const [items] = useState(() => compareItems(question, t("tools.ask.compare.current")));
	const [state, setState] = useState<CompareState>(() => compareStart(items, start));
	const [width, setWidth] = useState<HtmlViewport>(lastWidth);
	const count = items.length;
	const focused = items[state.focus];
	const left = items[state.left];

	const selectWidth = (next: HtmlViewport) => {
		lastWidth = next;
		setWidth(next);
	};
	const focusBody = () => rootRef.current?.focus({ preventScroll: true });
	const choose = (item: CompareItem | undefined) => {
		if (!item?.option || !onChoose) return;
		onChoose(item.option.label, item.option.index);
		focusBody();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (isImeComposing(event.nativeEvent) || ownsKeys(event.target)) return;
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			event.preventDefault();
			setState(flipCompare(state, count, event.key === "ArrowRight" ? 1 : -1));
			return;
		}
		const jump = compareJumpIndex(event.key, count);
		if (jump !== null) {
			event.preventDefault();
			setState(showCompareItem(state, jump));
			return;
		}
		if (event.key === "Enter" && event.target === event.currentTarget) {
			event.preventDefault();
			choose(focused);
		}
	};

	const pane = (item: CompareItem, extra: Partial<PaneProps> = {}) => (
		<ComparePane
			key={item.key}
			item={item}
			chosen={chosen}
			width={width}
			onChoose={onChoose ? () => choose(item) : undefined}
			onOpenFile={onOpenFile}
			{...extra}
		/>
	);

	let body: ReactNode = null;
	if (state.view === "grid") {
		body = (
			<div
				data-testid="ask-compare-grid"
				className="grid h-full auto-rows-[minmax(0,1fr)] grid-cols-2 gap-8 xl:grid-cols-3"
			>
				{items.map((item, index) => (
					<ComparePane
						key={item.key}
						item={item}
						chosen={chosen}
						width={width}
						onChoose={onChoose ? () => choose(item) : undefined}
						onOpenFile={onOpenFile}
						highlighted={index === state.focus}
						onTitle={() => {
							setState(showCompareItem(state, index));
							focusBody();
						}}
					/>
				))}
			</div>
		);
	} else if (state.view === "pair" && focused && left) {
		body = pairsVisually(left, focused) ? (
			<VisualPair left={left} right={focused} width={width} />
		) : (
			<div data-testid="ask-compare-pair" className="grid h-full grid-cols-2 gap-8">
				{pane(left, { onChoose: undefined })}
				{pane(focused, { onChoose: undefined })}
			</div>
		);
	} else if (focused) {
		body = pane(focused);
	}

	return (
		<section
			ref={rootRef}
			data-testid="ask-compare-body"
			aria-label={t("tools.ask.compare.title", { question: question.header || question.question })}
			aria-keyshortcuts="ArrowLeft ArrowRight Enter"
			tabIndex={-1}
			onKeyDown={onKeyDown}
			className="flex min-h-0 flex-1 flex-col gap-8 rounded-sm focus-visible:focus-ring-inset"
		>
			<div className="flex min-w-0 flex-wrap items-center gap-12 pr-[2rem]">
				<DialogTitle className="min-w-0 truncate">
					{t("tools.ask.compare.title", { question: question.header || question.question })}
				</DialogTitle>
				<div className="ml-auto flex flex-wrap items-center gap-12">
					{count > 1 ? (
						<fieldset
							data-testid="ask-compare-views"
							aria-label={t("tools.ask.compare.viewLabel")}
							className="m-0 hidden gap-2 border-0 p-0 sm:flex"
						>
							{COMPARE_VIEWS.map((view: CompareView) => (
								<Button
									key={view}
									variant="ghost"
									size="s"
									tabIndex={0}
									aria-pressed={state.view === view}
									data-selected={state.view === view}
									data-testid={`ask-compare-view-${view}`}
									onClick={() => setState(setCompareView(state, items, view))}
								>
									{t(VIEW_LABELS[view])}
								</Button>
							))}
						</fieldset>
					) : null}
					{hasHtmlFile(items) ? (
						<HtmlViewportSwitch viewport={width} onViewport={selectWidth} />
					) : null}
				</div>
			</div>
			<ItemStrip
				items={items}
				state={state}
				chosen={chosen}
				onShow={(index) => setState(showCompareItem(state, index))}
			/>
			{state.view === "pair" && focused && left ? (
				<PairBar
					items={items}
					left={left}
					right={focused}
					leftIndex={state.left}
					chosen={chosen}
					onLeft={(index) => setState(setCompareLeft(state, index))}
					onSwap={() => setState(swapCompare(state))}
					onChoose={onChoose ? choose : undefined}
				/>
			) : null}
			<div className="min-h-0 flex-1">{body}</div>
			<p data-testid="ask-compare-legend" className="text-text-muted tr-text-metadata">
				{onChoose
					? t("tools.ask.compare.legend", { last: count })
					: t("tools.ask.compare.legendReadOnly", { last: count })}
			</p>
		</section>
	);
}

function ChosenMark() {
	const t = useT();
	return (
		<span
			data-testid="ask-compare-chosen"
			className="inline-flex shrink-0 items-center gap-2 text-feedback-success tr-text-metadata"
		>
			<Check aria-hidden="true" className="size-14" />
			{t("tools.ask.compare.chosen")}
		</span>
	);
}

function ChooseControl({
	item,
	chosen,
	onChoose,
}: {
	item: CompareItem;
	chosen: string | null;
	onChoose: (() => void) | undefined;
}) {
	const t = useT();
	if (!item.option) return null;
	if (item.option.label === chosen) return <ChosenMark />;
	if (!onChoose) return null;
	return (
		<Button
			variant="primary"
			size="s"
			tabIndex={0}
			data-testid="ask-compare-choose"
			aria-label={t("tools.ask.compare.chooseLabel", { option: item.label })}
			onClick={onChoose}
			className="shrink-0"
		>
			{t("tools.ask.compare.choose")}
		</Button>
	);
}

function ItemTitle({ item }: { item: CompareItem }) {
	const t = useT();
	return (
		<>
			<span className="min-w-0 truncate">{item.label}</span>
			{item.recommended ? (
				<span className="shrink-0 text-primary tr-text-metadata">{t("tools.ask.recommended")}</span>
			) : null}
		</>
	);
}

function ItemStrip({
	items,
	state,
	chosen,
	onShow,
}: {
	items: readonly CompareItem[];
	state: CompareState;
	chosen: string | null;
	onShow: (index: number) => void;
}) {
	const t = useT();
	return (
		<div
			role="toolbar"
			aria-label={t("tools.ask.compare.itemsLabel")}
			className="flex min-w-0 flex-wrap gap-4"
		>
			{items.map((item, index) => {
				const shown =
					state.view === "grid" ||
					index === state.focus ||
					(state.view === "pair" && index === state.left);
				const side =
					state.view !== "pair"
						? null
						: index === state.left
							? t("tools.ask.compare.left")
							: index === state.focus
								? t("tools.ask.compare.right")
								: null;
				return (
					<button
						key={item.key}
						type="button"
						tabIndex={0}
						aria-pressed={shown}
						data-testid="ask-compare-item"
						data-item={item.key}
						data-shown={shown}
						onClick={() => onShow(index)}
						className={cn(
							"relative inline-flex min-w-0 max-w-full items-center gap-4 rounded-full border px-8 py-2 tr-text-ui focus-visible:focus-ring",
							shown && state.view !== "grid"
								? "border-primary bg-primary-subtle text-text-default"
								: "border-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
							!item.source && "border-dashed",
						)}
					>
						<span className="shrink-0 text-text-subtle tr-text-metadata">{index + 1}</span>
						<ItemTitle item={item} />
						{side ? <span className="shrink-0 text-primary tr-text-metadata">{side}</span> : null}
						{item.option && item.option.label === chosen ? (
							<>
								<Check aria-hidden="true" className="size-14 shrink-0 text-feedback-success" />
								<span className="sr-only">{t("tools.ask.compare.chosen")}</span>
							</>
						) : null}
					</button>
				);
			})}
		</div>
	);
}

function PairBar({
	items,
	left,
	right,
	leftIndex,
	chosen,
	onLeft,
	onSwap,
	onChoose,
}: {
	items: readonly CompareItem[];
	left: CompareItem;
	right: CompareItem;
	leftIndex: number;
	chosen: string | null;
	onLeft: (index: number) => void;
	onSwap: () => void;
	onChoose: ((item: CompareItem) => void) | undefined;
}) {
	const t = useT();
	return (
		<div data-testid="ask-compare-pair-bar" className="grid grid-cols-2 items-center gap-8">
			<div className="flex min-w-0 items-center gap-8">
				<span className="shrink-0 text-text-muted tr-text-metadata">
					{t("tools.ask.compare.left")}
				</span>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="s"
							tabIndex={0}
							iconRight={ChevronDown}
							data-testid="ask-compare-left"
							aria-label={t("tools.ask.compare.leftLabel", { item: left.label })}
							className="min-w-0"
						>
							<span className="min-w-0 truncate">{left.label}</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						<DropdownMenuRadioGroup
							value={String(leftIndex)}
							onValueChange={(value) => onLeft(Number(value))}
						>
							{items.map((item, index) => (
								<DropdownMenuRadioItem
									key={item.key}
									value={String(index)}
									data-testid="ask-compare-left-item"
								>
									{item.label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				<ChooseControl
					item={left}
					chosen={chosen}
					onChoose={onChoose ? () => onChoose(left) : undefined}
				/>
				<IconButton
					icon={Swap}
					size="s"
					tabIndex={0}
					label={t("tools.ask.compare.swap")}
					data-testid="ask-compare-swap"
					onClick={onSwap}
					className="ml-auto shrink-0"
				/>
			</div>
			<div className="flex min-w-0 items-center gap-8">
				<span className="shrink-0 text-text-muted tr-text-metadata">
					{t("tools.ask.compare.right")}
				</span>
				<span data-testid="ask-compare-right" className="flex min-w-0 items-center gap-4">
					<ItemTitle item={right} />
				</span>
				<ChooseControl
					item={right}
					chosen={chosen}
					onChoose={onChoose ? () => onChoose(right) : undefined}
				/>
			</div>
		</div>
	);
}

function VisualPair({
	left,
	right,
	width,
}: {
	left: CompareItem;
	right: CompareItem;
	width: HtmlViewport;
}) {
	const host = useOptionalResourceHost();
	const workspaceId = useResourceScope()?.workspaceId;
	if (left.source?.kind !== "file" || right.source?.kind !== "file") return null;
	if (!host || !workspaceId) {
		return (
			<div className="grid h-full grid-cols-2 gap-8">
				<FileUnavailable source={left.source} />
				<FileUnavailable source={right.source} />
			</div>
		);
	}
	return (
		<ResourcePreview
			key={`${left.key}\u0000${right.key}`}
			path={right.source.path}
			before={left.source.path}
			sideLabels={{ original: left.label, modified: right.label }}
			htmlViewport={width}
			compact
			reviewable={false}
			className="h-full rounded-sm border border-border-default"
		/>
	);
}

interface PaneProps {
	item: CompareItem;
	chosen: string | null;
	width: HtmlViewport;
	onChoose: (() => void) | undefined;
	onOpenFile: ((path: string) => void) | undefined;
	highlighted?: boolean | undefined;
	onTitle?: (() => void) | undefined;
}

function ComparePane({
	item,
	chosen,
	width,
	onChoose,
	onOpenFile,
	highlighted,
	onTitle,
}: PaneProps) {
	const host = useOptionalResourceHost();
	const workspaceId = useResourceScope()?.workspaceId;
	const { source } = item;
	const title = <PaneTitle item={item} onTitle={onTitle} />;
	const choose = <ChooseControl item={item} chosen={chosen} onChoose={onChoose} />;
	const framed = source?.kind === "file" && !!host && !!workspaceId;
	return (
		<section
			data-testid="ask-compare-pane"
			data-item={item.key}
			aria-label={item.label}
			className={cn(
				"flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border",
				highlighted ? "border-primary" : "border-border-default",
			)}
		>
			{framed ? (
				<ResourcePreview
					path={source.path}
					before={source.before}
					htmlViewport={width}
					compact
					reviewable={false}
					leading={title}
					actions={choose}
					className="min-h-0 flex-1"
				/>
			) : (
				<>
					<div className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-12">
						<div className="mr-auto flex min-w-0 items-center">{title}</div>
						{choose}
					</div>
					<div className="min-h-0 flex-1">
						<PaneBody source={source} onOpenFile={onOpenFile} />
					</div>
				</>
			)}
		</section>
	);
}

function PaneTitle({ item, onTitle }: { item: CompareItem; onTitle?: (() => void) | undefined }) {
	const t = useT();
	if (!onTitle) {
		return (
			<span className="flex min-w-0 items-center gap-4 text-text-default tr-text-ui">
				<ItemTitle item={item} />
			</span>
		);
	}
	return (
		<button
			type="button"
			tabIndex={0}
			data-testid="ask-compare-pane-title"
			aria-label={t("tools.ask.compare.showAlone", { item: item.label })}
			onClick={onTitle}
			className="flex min-w-0 items-center gap-4 rounded-sm text-left text-text-default tr-text-ui hover:underline focus-visible:focus-ring"
		>
			<ItemTitle item={item} />
		</button>
	);
}

function PaneBody({
	source,
	onOpenFile,
}: {
	source: CompareItem["source"];
	onOpenFile: ((path: string) => void) | undefined;
}) {
	const t = useT();
	if (!source) {
		return (
			<div
				data-testid="ask-compare-none"
				className="flex h-full items-center justify-center px-12 text-center text-text-muted tr-text-metadata"
			>
				{t("tools.ask.noPreview")}
			</div>
		);
	}
	if (source.kind === "markdown") {
		return (
			<div className="h-full overflow-auto bg-container-content-bg px-12 py-8">
				<PreviewMarkdown text={source.text} />
			</div>
		);
	}
	return <FileUnavailable source={source} onOpenFile={onOpenFile} />;
}
