import {
	RiArrowLeftRightLine,
	RiChat3Line,
	RiCloseLine,
	RiExpandDiagonalLine,
	RiMoreLine,
	RiPriceTag3Line,
	RiRobot2Line,
	RiStickyNoteLine,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	ExportKind,
	LabelCount,
	SessionLabels,
	SessionOverview,
} from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { Fragment, type ReactNode, useRef, useState } from "react";
import { isBadged, OUTCOME_LABEL, OUTCOME_TONE, sessionName } from "../copy";
import { chatTargetOf } from "../details/DetailsPanel";
import {
	EXPORT_KINDS,
	ExportDialogs,
	ExportKindLabel,
	type ExportRequest,
	type ExportTarget,
	ExportTrigger,
} from "../export/ExportMenu";
import { FigureBadge, FigureDetails, type FigureView, Pill, type Sources } from "../FigureCell";
import {
	formatCost,
	formatCostExact,
	formatCount,
	formatDateTime,
	formatDuration,
	formatStart,
	formatTokens,
} from "../format";
import { LabelChips, LabelsButton, LabelsForm } from "../labels/LabelsEditor";
import type { ComparedSession } from "../load";
import { guessedWidth, useWidth } from "../width";
import { CompareButton, CompareChooser } from "./ComparePicker";

/** The user's labels and note for the header, with the labels in use for suggestions. */
export interface HeaderLabels {
	entry: SessionLabels | null;
	vocabulary: readonly LabelCount[];
}

export type HeaderChip = "start" | "wall" | "active" | "tokens" | "cost" | "outcome" | "model";

/** What the one-line header shows at a width; the rest is behind its "⋯". */
export interface HeaderLayout {
	hidden: ReadonlySet<HeaderChip>;
	crumb: boolean;
	actions: boolean;
	labels: number;
}

/** Below each width the row hands chips to the overflow: the date and the model first, then the rest but cost. */
const TIERS: readonly { below: number; hide: readonly HeaderChip[] }[] = [
	{ below: 1150, hide: ["start", "model"] },
	{ below: 950, hide: ["tokens", "wall", "active", "outcome"] },
];
/** Below this the crumb and the actions move into the overflow too, and one label chip stays. */
const ROOMY = 760;
const CHIP_ORDER: readonly HeaderChip[] = [
	"start",
	"wall",
	"active",
	"tokens",
	"cost",
	"outcome",
	"model",
];

export function headerLayout(width: number): HeaderLayout {
	const hidden = new Set<HeaderChip>();
	for (const tier of TIERS) if (width < tier.below) for (const chip of tier.hide) hidden.add(chip);
	const roomy = width >= ROOMY;
	return { hidden, crumb: roomy, actions: roomy, labels: roomy ? 3 : 1 };
}

/** A figure chip: its compact value, the provenance tooltip and the overflow's caption. */
export interface HeaderFigure {
	id: Exclude<HeaderChip, "outcome" | "model">;
	label: string;
	text: string;
	figures: readonly FigureView[];
}

/** The header's figure chips with each one's provenance, as the list shows them. */
export function headerFigures(
	t: Translator,
	session: SessionOverview,
	now: number,
): HeaderFigure[] {
	const locale = localeOf(t);
	const tokens = session.tokens.value;
	const outside = session.subagentsOutside.value;
	const cost: FigureView[] = [
		{
			metric: "cost",
			origin: session.cost.origin,
			exact: session.cost.value === null ? null : formatCostExact(locale, session.cost.value),
		},
	];
	if (outside !== null && (outside.cost > 0 || outside.tokens > 0))
		cost.push({
			metric: "subagentsOutside",
			origin: session.subagentsOutside.origin,
			exact: formatCostExact(locale, outside.cost),
			detail: t("sessionInsights.cost.tokens", { tokens: formatCount(locale, outside.tokens) }),
		});
	const duration = (ms: number | null) => (ms === null ? "—" : formatDuration(t, ms));
	const exactDuration = (ms: number | null) => (ms === null ? null : formatDuration(t, ms, true));
	return [
		{
			id: "start",
			label: t("sessionInsights.column.start"),
			text: session.start.value === null ? "—" : formatStart(locale, session.start.value, now),
			figures: [
				{
					metric: "start",
					origin: session.start.origin,
					exact: session.start.value === null ? null : formatDateTime(locale, session.start.value),
				},
			],
		},
		{
			id: "wall",
			label: t("sessionInsights.session.wall"),
			text: duration(session.wallMs.value),
			figures: [
				{
					metric: "wallTime",
					origin: session.wallMs.origin,
					exact: exactDuration(session.wallMs.value),
				},
			],
		},
		{
			id: "active",
			label: t("sessionInsights.column.active"),
			text: duration(session.activeMs.value),
			figures: [
				{
					metric: "activeTime",
					origin: session.activeMs.origin,
					exact: exactDuration(session.activeMs.value),
				},
			],
		},
		{
			id: "tokens",
			label: t("sessionInsights.column.tokens"),
			text:
				tokens === null
					? "—"
					: t("sessionInsights.header.tokens", { tokens: formatTokens(locale, tokens.total) }),
			figures: [
				{
					metric: "tokens",
					origin: session.tokens.origin,
					exact: tokens === null ? null : formatCount(locale, tokens.total),
					detail:
						tokens === null
							? undefined
							: t("sessionInsights.figure.tokenBreakdown", {
									input: formatCount(locale, tokens.input),
									output: formatCount(locale, tokens.output),
									cacheRead: formatCount(locale, tokens.cacheRead),
									cacheWrite: formatCount(locale, tokens.cacheWrite),
								}),
				},
			],
		},
		{
			id: "cost",
			label: t("sessionInsights.column.cost"),
			text:
				session.cost.value === null
					? "—"
					: session.cost.origin === "notRecorded" && tokens !== null
						? t("sessionInsights.session.costNotRecorded", {
								tokens: formatTokens(locale, tokens.total),
							})
						: formatCost(locale, session.cost.value),
			figures: cost,
		},
	];
}

/**
 * Beside its chat (the host offers `showInChat`, `openAsTab` or `closePane`): moving the analysis to its
 * own tab and closing the pane, each offered when the host has it and run after `beforeLeave`.
 */
export function paneActions(
	host: PanelHost,
	beforeLeave: () => void,
): { openAsTab: (() => void) | null; close: (() => void) | null } | null {
	const { showInChat, openAsTab, closePane } = host;
	if (!showInChat && !openAsTab && !closePane) return null;
	return {
		openAsTab: openAsTab
			? () => {
					beforeLeave();
					host.openAsTab?.();
				}
			: null,
		close: closePane
			? () => {
					beforeLeave();
					host.closePane?.();
				}
			: null,
	};
}

const CHIP_CLASS =
	"flex min-w-0 shrink-0 items-center gap-4 rounded-sm tr-text-metadata text-text-default tabular-nums underline decoration-dashed decoration-text-subtle underline-offset-4 focus-visible:focus-ring";

function FigureChip({ figure, sources }: { figure: HeaderFigure; sources: Sources }) {
	const origin = figure.figures[0]?.origin;
	return (
		<IconTooltip label={<FigureDetails figures={figure.figures} sources={sources} />} align="start">
			<button
				type="button"
				data-testid={`session-insights-session-${figure.id}`}
				aria-label={`${figure.label}: ${figure.text}`}
				className={CHIP_CLASS}
			>
				<span className="truncate">{figure.text}</span>
				{origin && isBadged(origin) ? <FigureBadge origin={origin} /> : null}
			</button>
		</IconTooltip>
	);
}

function OutcomeChip({ session }: { session: SessionOverview }) {
	const t = useT();
	return session.outcome ? (
		<Pill testId="session-insights-session-outcome" className={OUTCOME_TONE[session.outcome]}>
			{t(OUTCOME_LABEL[session.outcome])}
		</Pill>
	) : null;
}

function ModelChip({ models }: { models: readonly string[] }) {
	const t = useT();
	const [main, ...others] = models;
	if (!main) return null;
	return (
		<IconTooltip
			label={
				<span className="flex flex-col gap-2">
					<span className="text-text-muted">{t("sessionInsights.session.models")}</span>
					{models.map((model) => (
						<span key={model} className="tr-code-text-small">
							{model}
						</span>
					))}
				</span>
			}
			align="start"
		>
			<button
				type="button"
				data-testid="session-insights-session-models"
				aria-label={`${t("sessionInsights.session.models")}: ${models.join(", ")}`}
				className={cn(CHIP_CLASS, "tr-code-text-small")}
			>
				<span className="truncate">{main.split("/").pop()}</span>
				{others.length > 0 ? (
					<span className="text-text-muted">
						{t("sessionInsights.header.moreModels", { n: others.length })}
					</span>
				) : null}
			</button>
		</IconTooltip>
	);
}

function OutsideChip({ session, sources }: { session: SessionOverview; sources: Sources }) {
	const t = useT();
	const locale = localeOf(t);
	const outside = session.subagentsOutside.value;
	if (outside === null || (outside.cost <= 0 && outside.tokens <= 0)) return null;
	const line =
		outside.cost > 0
			? t("sessionInsights.cost.subagentsOutside", { cost: formatCost(locale, outside.cost) })
			: t("sessionInsights.cost.subagentsOutsideTokens", {
					tokens: formatTokens(locale, outside.tokens),
				});
	return (
		<IconTooltip
			label={
				<span className="flex flex-col gap-4">
					<span>{line}</span>
					<FigureDetails
						figures={[
							{
								metric: "subagentsOutside",
								origin: session.subagentsOutside.origin,
								exact: formatCostExact(locale, outside.cost),
								detail: t("sessionInsights.cost.tokens", {
									tokens: formatCount(locale, outside.tokens),
								}),
							},
						]}
						sources={sources}
					/>
				</span>
			}
			align="start"
		>
			<button
				type="button"
				data-testid="session-insights-session-outside"
				aria-label={line}
				className={cn(CHIP_CLASS, "text-text-muted")}
			>
				<RiRobot2Line aria-hidden className="size-12 shrink-0" />
				{t("sessionInsights.header.outside", {
					value:
						outside.cost > 0
							? formatCost(locale, outside.cost)
							: formatTokens(locale, outside.tokens),
				})}
				{isBadged(session.subagentsOutside.origin) ? (
					<FigureBadge origin={session.subagentsOutside.origin} />
				) : null}
			</button>
		</IconTooltip>
	);
}

function Crumb({ session }: { session: SessionOverview }) {
	const t = useT();
	const where = [session.projectName, session.workspaceName].filter(Boolean).join(" › ");
	const text = where || t("sessionInsights.group.unregistered");
	return (
		<span
			data-testid="session-insights-session-crumb"
			className="flex min-w-0 max-w-240 shrink items-center gap-4 tr-text-metadata text-text-muted"
		>
			<span className="truncate" title={text}>
				{text}
			</span>
			{session.live ? (
				<Pill testId="session-insights-live" className="border-primary-muted text-primary">
					{t("sessionInsights.badge.live")}
				</Pill>
			) : null}
			{session.workspaceState === "removed" ? (
				<Pill testId="session-insights-removed" className="border-border-default text-text-subtle">
					{t("sessionInsights.badge.removed")}
				</Pill>
			) : null}
		</span>
	);
}

function OpenChat({ host, session }: { host: PanelHost; session: SessionOverview }) {
	const t = useT();
	const target = chatTargetOf(session);
	return (
		<Button
			variant="outline"
			size="s"
			iconLeft={RiChat3Line}
			data-testid="session-insights-session-open-chat"
			disabled={!target}
			tooltip={target ? undefined : t("sessionInsights.details.chatUnavailable")}
			onClick={() => target && host.openChat(target)}
		>
			{t("sessionInsights.openChat")}
		</Button>
	);
}

type OverflowView = "list" | "compare" | "labels";

/** The "⋯" of a narrow header: the figures, crumb and actions the row has no room for. */
function Overflow({
	host,
	session,
	sources,
	labels,
	from,
	figures,
	layout,
	pane,
	onExport,
}: {
	host: PanelHost;
	session: SessionOverview;
	sources: Sources;
	labels: HeaderLabels | null;
	from: ComparedSession;
	figures: readonly HeaderFigure[];
	layout: HeaderLayout;
	pane: boolean;
	onExport: (kind: ExportKind) => void;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<OverflowView>("list");
	const input = useRef<HTMLInputElement>(null);
	const hidden = figures.filter((figure) => layout.hidden.has(figure.id));
	const target = chatTargetOf(session);
	const close = () => {
		setOpen(false);
		setView("list");
	};
	const caption = (text: string) => <dt className="text-text-subtle">{text}</dt>;
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setView("list");
			}}
		>
			<PopoverTrigger asChild>
				<IconButton
					icon={RiMoreLine}
					size="s"
					label={t("sessionInsights.header.more")}
					data-testid="session-insights-header-more"
					aria-haspopup="dialog"
				/>
			</PopoverTrigger>
			<PopoverContent align="end" className="p-0">
				{view === "compare" ? (
					<CompareChooser host={host} from={from} onPicked={close} />
				) : view === "labels" && labels ? (
					<LabelsForm
						host={host}
						sessionId={session.sessionId}
						initial={labels.entry?.labels ?? []}
						vocabulary={labels.vocabulary}
						inputRef={input}
						onDone={close}
					/>
				) : (
					<div
						data-testid="session-insights-header-overflow"
						className="flex w-280 max-w-full flex-col gap-8 p-8"
					>
						{layout.crumb ? null : <Crumb session={session} />}
						{hidden.length > 0 || layout.hidden.has("outcome") || layout.hidden.has("model") ? (
							<dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-12 gap-y-4 tr-text-metadata">
								{CHIP_ORDER.map((id) => {
									if (!layout.hidden.has(id)) return null;
									if (id === "outcome")
										return session.outcome ? (
											<Fragment key={id}>
												{caption(t("sessionInsights.column.outcome"))}
												<dd className="flex min-w-0">
													<OutcomeChip session={session} />
												</dd>
											</Fragment>
										) : null;
									if (id === "model")
										return session.models.length > 0 ? (
											<Fragment key={id}>
												{caption(t("sessionInsights.session.models"))}
												<dd className="flex min-w-0">
													<ModelChip models={session.models} />
												</dd>
											</Fragment>
										) : null;
									const figure = hidden.find((item) => item.id === id);
									return figure ? (
										<Fragment key={id}>
											{caption(figure.label)}
											<dd className="flex min-w-0">
												<FigureChip figure={figure} sources={sources} />
											</dd>
										</Fragment>
									) : null;
								})}
							</dl>
						) : null}
						{layout.actions ? null : (
							<div className="flex flex-col items-start gap-2 border-border-default border-t pt-8">
								<Button
									variant="ghost"
									size="s"
									iconLeft={RiArrowLeftRightLine}
									data-testid="session-insights-compare-with"
									onClick={() => setView("compare")}
								>
									{t("sessionInsights.header.compareWith")}
								</Button>
								{labels ? (
									<Button
										variant="ghost"
										size="s"
										iconLeft={RiPriceTag3Line}
										data-testid="session-insights-session-labels"
										onClick={() => setView("labels")}
									>
										{t("sessionInsights.labels.title")}
									</Button>
								) : null}
								{EXPORT_KINDS.map((kind) => (
									<Button
										key={kind}
										variant="ghost"
										size="s"
										data-testid="session-insights-export-item"
										data-kind={kind}
										onClick={() => {
											close();
											onExport(kind);
										}}
									>
										<ExportKindLabel kind={kind} />
									</Button>
								))}
								{pane ? null : (
									<Button
										variant="ghost"
										size="s"
										iconLeft={RiChat3Line}
										data-testid="session-insights-session-open-chat"
										disabled={!target}
										tooltip={target ? undefined : t("sessionInsights.details.chatUnavailable")}
										onClick={() => {
											close();
											if (target) host.openChat(target);
										}}
									>
										{t("sessionInsights.openChat")}
									</Button>
								)}
							</div>
						)}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

function NoteIcon({
	host,
	session,
	labels,
	note,
}: {
	host: PanelHost;
	session: SessionOverview;
	labels: HeaderLabels;
	note: string;
}) {
	const t = useT();
	const tooltip = <span className="line-clamp-10 block max-w-320 whitespace-pre-wrap">{note}</span>;
	return (
		<LabelsButton
			host={host}
			sessionId={session.sessionId}
			labels={labels.entry?.labels ?? []}
			noted
			vocabulary={labels.vocabulary}
			trigger={
				<IconButton
					icon={RiStickyNoteLine}
					size="s"
					label={t("sessionInsights.labels.note")}
					tooltip={tooltip}
					data-testid="session-insights-session-note"
					aria-haspopup="dialog"
				/>
			}
		/>
	);
}

/**
 * The session tab's one-line header: the title, the user's labels and note, the crumb, the figure chips
 * with their provenance and the actions; what a narrow row (a chat pane) has no room for goes behind "⋯".
 */
export function Header({
	host,
	session,
	sources,
	labels,
	exportTarget,
	beforeLeave,
}: {
	host: PanelHost;
	session: SessionOverview;
	sources: Sources;
	labels: HeaderLabels | null;
	exportTarget: ExportTarget;
	/** Runs before the pane moves to a tab or closes (the view state is saved first). */
	beforeLeave: () => void;
}) {
	const t = useT();
	const [root, setRoot] = useState<HTMLElement | null>(null);
	const width = useWidth(root, guessedWidth(host.placement));
	const [request, setRequest] = useState<ExportRequest | null>(null);
	const layout = headerLayout(width);
	const name = sessionName(t, session);
	const figures = headerFigures(t, session, Date.now());
	const pane = paneActions(host, beforeLeave);
	const from: ComparedSession = { sessionId: session.sessionId, name };
	const onExport = (kind: ExportKind) => setRequest({ kind, attempt: (request?.attempt ?? 0) + 1 });
	const note = labels?.entry?.note ?? "";
	const overflows = layout.hidden.size > 0 || !layout.crumb || !layout.actions;
	const chip = (id: HeaderChip): ReactNode => {
		if (layout.hidden.has(id)) return null;
		if (id === "outcome") return <OutcomeChip key={id} session={session} />;
		if (id === "model") return <ModelChip key={id} models={session.models} />;
		const figure = figures.find((item) => item.id === id);
		if (!figure) return null;
		return (
			<Fragment key={id}>
				<FigureChip figure={figure} sources={sources} />
				{id === "cost" ? <OutsideChip session={session} sources={sources} /> : null}
			</Fragment>
		);
	};
	return (
		<header
			ref={setRoot}
			data-testid="session-insights-header"
			data-layout={layout.actions ? "wide" : "narrow"}
			className="flex h-40 shrink-0 items-center gap-8 border-border-default border-b px-12"
		>
			<h1
				data-testid="session-insights-session-title"
				className="min-w-0 max-w-420 shrink truncate tr-title-compact text-text-default"
				title={name}
			>
				{name}
			</h1>
			{labels?.entry && labels.entry.labels.length > 0 ? (
				<span
					data-testid="session-insights-session-user"
					className="flex min-w-0 max-w-240 shrink-0 items-center overflow-hidden"
				>
					<LabelChips
						labels={labels.entry.labels}
						max={layout.labels}
						testId="session-insights-session-label"
						className="flex-nowrap"
					/>
				</span>
			) : null}
			{labels && note ? (
				<NoteIcon host={host} session={session} labels={labels} note={note} />
			) : null}
			{layout.crumb ? <Crumb session={session} /> : null}
			<span className="flex shrink-0 items-center gap-8">{CHIP_ORDER.map(chip)}</span>
			<span className="ml-auto flex shrink-0 items-center gap-4">
				{overflows ? (
					<Overflow
						host={host}
						session={session}
						sources={sources}
						labels={labels}
						from={from}
						figures={figures}
						layout={layout}
						pane={pane !== null}
						onExport={onExport}
					/>
				) : null}
				{layout.actions ? (
					<>
						<CompareButton host={host} from={from} />
						{labels ? (
							<LabelsButton
								host={host}
								sessionId={session.sessionId}
								labels={labels.entry?.labels ?? []}
								noted={labels.entry?.noted ?? false}
								vocabulary={labels.vocabulary}
								trigger={
									<Button
										variant="outline"
										size="s"
										iconLeft={RiPriceTag3Line}
										data-testid="session-insights-session-labels"
										aria-haspopup="dialog"
									>
										{t("sessionInsights.labels.title")}
									</Button>
								}
							/>
						) : null}
						<ExportTrigger onPick={onExport} />
						{pane ? null : <OpenChat host={host} session={session} />}
					</>
				) : null}
				{pane?.openAsTab ? (
					<IconButton
						icon={RiExpandDiagonalLine}
						size="s"
						label={t("sessionInsights.header.openAsTab")}
						data-testid="session-insights-open-as-tab"
						onClick={pane.openAsTab}
					/>
				) : null}
				{pane?.close ? (
					<IconButton
						icon={RiCloseLine}
						size="s"
						label={t("sessionInsights.header.closePane")}
						data-testid="session-insights-close-pane"
						onClick={pane.close}
					/>
				) : null}
			</span>
			<ExportDialogs
				host={host}
				sessionId={session.sessionId}
				target={exportTarget}
				request={request}
				onClose={() => setRequest(null)}
			/>
		</header>
	);
}
