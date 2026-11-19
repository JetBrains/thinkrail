import { RiArrowLeftRightLine, RiMore2Line } from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	AlignOp,
	AlignRow,
	AlignStep,
	SessionAlignment,
	SessionOverview,
	SessionSummaryResult,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { OUTCOME_LABEL, OUTCOME_TONE, sessionName } from "../copy";
import { Pill } from "../FigureCell";
import { requestSessionFocus } from "../focus";
import {
	formatCost,
	formatCount,
	formatDateTime,
	formatDuration,
	formatPercent,
	formatStart,
	formatTokens,
} from "../format";
import { hostServesThisVersion, SESSION_PANEL } from "../load";
import { loadSummary, PENDING, type Pending } from "../session/api";
import { ACTIVITY_LOOK } from "../stats/activityLook";
import { Fig } from "../stats/Fig";
import { useKeyedQuery } from "../useKeyedQuery";
import { type LoadedAlignment, loadAlignment } from "./api";
import { type AlignItem, alignItems } from "./items";

type Side = "a" | "b";

const SIDE_TEXT = { a: "text-series-1", b: "text-series-6" } as const;
const SIDE_BORDER = { a: "border-series-1", b: "border-series-6" } as const;
const SHELL_TOOLS: readonly string[] = ["bash", "background_command"];

/** A session's header card, asked again while the host's index has not reached the session yet. */
function useSummary(host: PanelHost, sessionId: string, attempt: number) {
	return useKeyedQuery(
		`${sessionId}:${attempt}`,
		(signal) => loadSummary(host, sessionId, signal),
		(value) => value.session === null && value.pending,
	);
}

function useAlignment(host: PanelHost, a: string, b: string, attempt: number) {
	return useKeyedQuery<LoadedAlignment | Pending | null>(
		`${a}:${b}:${attempt}`,
		(signal, progress) => loadAlignment(host, a, b, signal, progress),
		(value) => value === PENDING,
	);
}

/** "+m:ss" (or "+h:mm:ss") from the start of the step's turn. */
export function formatOffset(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0
		? `+${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `+${minutes}:${seconds}`;
}

function SidePill({ side }: { side: Side }) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-flex size-16 shrink-0 items-center justify-center rounded-sm border tr-text-caption",
				SIDE_BORDER[side],
				SIDE_TEXT[side],
			)}
		>
			{side === "a" ? "A" : "B"}
		</span>
	);
}

function SessionCard({
	side,
	session,
	sources,
	turns,
}: {
	side: Side;
	session: SessionOverview;
	sources: SessionSummaryResult["sources"];
	turns: number | null;
}) {
	const t = useT();
	const locale = localeOf(t);
	const tokens = session.tokens.value;
	const figure = (
		testId: string,
		metric: "start" | "toolCalls" | "toolErrors" | "tokens" | "activeTime" | "subagents" | "cost",
		text: string,
		origin: SessionOverview["start"]["origin"],
		exact: string | null,
	) => (
		<Fig
			testId={testId}
			text={text}
			origin={origin}
			sources={sources}
			figures={[{ metric, origin, exact }]}
			className="tr-text-metadata"
		/>
	);
	return (
		<section
			data-testid={`compare-card-${side}`}
			data-session-id={session.sessionId}
			className={cn(
				"flex min-w-0 flex-1 flex-col gap-4 rounded-md border bg-container-sidebar-bg px-12 py-8",
				SIDE_BORDER[side],
			)}
		>
			<div className="flex min-w-0 items-center gap-8">
				<SidePill side={side} />
				<h2
					className="min-w-0 flex-1 truncate tr-title-compact text-text-default"
					title={sessionName(t, session)}
				>
					{sessionName(t, session)}
				</h2>
				{session.outcome ? (
					<Pill testId="compare-card-outcome" className={OUTCOME_TONE[session.outcome]}>
						{t(OUTCOME_LABEL[session.outcome])}
					</Pill>
				) : null}
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-x-12 gap-y-2 text-text-muted">
				{figure(
					"compare-card-start",
					"start",
					session.start.value === null ? "—" : formatStart(locale, session.start.value, Date.now()),
					session.start.origin,
					session.start.value === null ? null : formatDateTime(locale, session.start.value),
				)}
				{turns !== null ? (
					<span className="tr-text-metadata">
						{t("sessionInsights.compare.turns", { count: turns })}
					</span>
				) : null}
				{figure(
					"compare-card-calls",
					"toolCalls",
					t("sessionInsights.compare.calls", { count: session.toolCalls.value ?? 0 }),
					session.toolCalls.origin,
					session.toolCalls.value === null ? null : formatCount(locale, session.toolCalls.value),
				)}
				{session.toolErrors.value ? (
					<span className="text-feedback-error">
						{figure(
							"compare-card-errors",
							"toolErrors",
							`✕${formatCount(locale, session.toolErrors.value)}`,
							session.toolErrors.origin,
							formatCount(locale, session.toolErrors.value),
						)}
					</span>
				) : null}
				{figure(
					"compare-card-tokens",
					"tokens",
					tokens === null
						? "—"
						: t("sessionInsights.compare.tokens", { tokens: formatTokens(locale, tokens.total) }),
					session.tokens.origin,
					tokens === null ? null : formatCount(locale, tokens.total),
				)}
				{session.cost.origin === "recorded" && session.cost.value !== null
					? figure(
							"compare-card-cost",
							"cost",
							formatCost(locale, session.cost.value),
							session.cost.origin,
							formatCost(locale, session.cost.value),
						)
					: null}
				{figure(
					"compare-card-active",
					"activeTime",
					session.activeMs.value === null
						? "—"
						: t("sessionInsights.compare.active", {
								time: formatDuration(t, session.activeMs.value),
							}),
					session.activeMs.origin,
					session.activeMs.value === null ? null : formatDuration(t, session.activeMs.value, true),
				)}
				{session.subagents.value
					? figure(
							"compare-card-subagents",
							"subagents",
							t("sessionInsights.compare.subagents", { count: session.subagents.value }),
							session.subagents.origin,
							formatCount(locale, session.subagents.value),
						)
					: null}
			</div>
		</section>
	);
}

const STRIP_W = 1000;
const STRIP_H = 80;
const ROW_A = 4;
const ROW_B = 58;
const BLOCK_H = 18;
const STRIP_GAP = 4;

const percent = (value: number) => `${((value / STRIP_W) * 100).toFixed(2)}%`;

/** Both sessions' turns as blocks sized by their calls, with the turn pairs as bands between them. */
export function TurnStrip({ alignment }: { alignment: SessionAlignment }) {
	const t = useT();
	const locale = localeOf(t);
	const units = (calls: number) => Math.max(3, calls);
	const total = Math.max(
		1,
		alignment.a.turns.reduce((sum, turn) => sum + units(turn.calls), 0),
		alignment.b.turns.reduce((sum, turn) => sum + units(turn.calls), 0),
	);
	const most = Math.max(alignment.a.turns.length, alignment.b.turns.length);
	const perUnit = (STRIP_W - STRIP_GAP * most) / total;
	const place = (turns: SessionAlignment["a"]["turns"]) => {
		let x = 0;
		return turns.map((turn) => {
			const width = units(turn.calls) * perUnit;
			const block = { turn, x, width };
			x += width + STRIP_GAP;
			return block;
		});
	};
	const blocksA = place(alignment.a.turns);
	const blocksB = place(alignment.b.turns);
	const bands = alignment.pairs.flatMap((pair) => {
		const top = blocksA[pair.a];
		const bottom = blocksB[pair.b];
		return top && bottom ? [{ pair, top, bottom }] : [];
	});
	const blocks = (list: typeof blocksA, y: number, side: Side) =>
		list.map((block) => (
			<rect
				key={`${side}:${block.turn.eventId || block.turn.n}`}
				data-testid={`compare-turn-${side}`}
				x={block.x}
				y={y}
				width={block.width}
				height={BLOCK_H}
				fillOpacity={0.22}
				vectorEffect="non-scaling-stroke"
				className={side === "a" ? "fill-series-1 stroke-series-1" : "fill-series-6 stroke-series-6"}
			/>
		));
	const captions = (list: typeof blocksA, y: number, side: Side) =>
		list.map((block) =>
			block.width < STRIP_W * 0.025 ? null : (
				<text
					key={`${side}:${block.turn.eventId || block.turn.n}`}
					x={percent(block.x)}
					dx={4}
					y={y + 13}
					className="fill-text-default tr-code-text-small"
				>
					#{block.turn.n}
					{block.width >= STRIP_W * 0.12
						? ` · ${t("sessionInsights.compare.calls", { count: block.turn.calls })}`
						: ""}
				</text>
			),
		);
	return (
		<div className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-x-8">
			<div className="flex flex-col justify-between py-2 tr-text-metadata">
				<span className="text-series-1">{t("sessionInsights.compare.turnsA")}</span>
				<span className="text-series-6">{t("sessionInsights.compare.turnsB")}</span>
			</div>
			<div
				data-testid="compare-turn-strip"
				role="img"
				aria-label={t("sessionInsights.compare.stripTurns", {
					a: alignment.a.turns.length,
					b: alignment.b.turns.length,
					pairs: alignment.pairs.length,
				})}
				className="relative h-80 min-w-0 overflow-hidden"
			>
				<svg
					aria-hidden="true"
					viewBox={`0 0 ${STRIP_W} ${STRIP_H}`}
					preserveAspectRatio="none"
					className="absolute inset-0 block h-full w-full"
				>
					{bands.map(({ pair, top, bottom }) => (
						<path
							key={`${pair.a}:${pair.b}`}
							data-testid="compare-turn-pair"
							d={`M${top.x},${ROW_A + BLOCK_H} L${top.x + top.width},${ROW_A + BLOCK_H} L${bottom.x + bottom.width},${ROW_B} L${bottom.x},${ROW_B} Z`}
							vectorEffect="non-scaling-stroke"
							className="fill-control-bg-hovered stroke-border-default"
						/>
					))}
					{blocks(blocksA, ROW_A, "a")}
					{blocks(blocksB, ROW_B, "b")}
				</svg>
				<svg aria-hidden="true" width="100%" height={STRIP_H} className="absolute inset-0 block">
					{captions(blocksA, ROW_A, "a")}
					{captions(blocksB, ROW_B, "b")}
					{bands.map(({ pair, top, bottom }) => (
						<text
							key={`${pair.a}:${pair.b}`}
							x={percent((top.x + top.width / 2 + bottom.x + bottom.width / 2) / 2)}
							y={(ROW_A + BLOCK_H + ROW_B) / 2 + 4}
							textAnchor="middle"
							className="fill-text-muted tr-text-metadata"
						>
							{pair.by === "first"
								? t("sessionInsights.compare.pairFirst")
								: t("sessionInsights.compare.pairPrompt", {
										share: formatPercent(locale, pair.similarity),
									})}
						</text>
					))}
				</svg>
			</div>
		</div>
	);
}

function StepCell({
	side,
	index,
	step,
	onOpen,
}: {
	side: Side;
	index: number;
	step: AlignStep | undefined;
	onOpen: (side: Side, step: AlignStep) => void;
}) {
	const t = useT();
	if (!step) return <span className="min-w-0" />;
	const shell = SHELL_TOOLS.includes(step.tool);
	return (
		<button
			type="button"
			data-testid={`align-step-${side}`}
			data-event-id={step.eventId}
			data-failed={step.failed}
			title={t("sessionInsights.compare.openStep")}
			onClick={() => onOpen(side, step)}
			className="flex h-full w-full min-w-0 items-center gap-6 px-8 text-left hover:bg-control-bg-hovered focus-visible:focus-ring-inset"
		>
			<span className="w-32 shrink-0 text-right tr-code-text-small text-text-subtle">
				{index + 1}
			</span>
			<span
				aria-hidden
				className={cn(
					"inline-block size-8 shrink-0 rounded-full",
					step.failed ? "bg-feedback-error" : ACTIVITY_LOOK[step.activity].bg,
				)}
			/>
			{shell ? null : (
				<span className="shrink-0 tr-code-text-small text-text-default">{step.tool}</span>
			)}
			<span
				className={cn(
					"min-w-0 flex-1 truncate tr-code-text-small",
					shell ? "text-text-default" : "text-text-muted",
				)}
			>
				{step.label}
			</span>
			{step.failed ? (
				<span className="shrink-0 rounded-sm border border-feedback-error-muted px-4 tr-text-caption text-feedback-error">
					{t("sessionInsights.compare.failed")}
				</span>
			) : null}
			<span className="shrink-0 tr-code-text-small text-text-subtle">
				{formatOffset(step.offset)}
			</span>
		</button>
	);
}

function Connector({ op }: { op: AlignOp }) {
	const t = useT();
	if (op === "onlyA" || op === "onlyB") return <span aria-hidden className="w-40" />;
	return (
		<span
			data-testid="align-connector"
			data-op={op}
			title={
				op === "same"
					? t("sessionInsights.compare.sameTitle")
					: t("sessionInsights.compare.similarTitle")
			}
			className="flex w-40 items-center justify-center"
		>
			<span
				className={cn(
					"flex size-18 items-center justify-center rounded-full border tr-code-text-small",
					op === "same"
						? "border-text-muted text-text-default"
						: "border-text-subtle border-dashed text-text-muted",
				)}
			>
				{op === "same" ? "=" : "≈"}
			</span>
		</span>
	);
}

function RowLine({
	row,
	stepsA,
	stepsB,
	onOpen,
}: {
	row: AlignRow;
	stepsA: ReadonlyMap<number, AlignStep>;
	stepsB: ReadonlyMap<number, AlignStep>;
	onOpen: (side: Side, step: AlignStep) => void;
}) {
	return (
		<div
			data-testid="align-row"
			data-op={row.op}
			className="grid h-28 grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] border-border-muted border-b"
		>
			<div
				className={cn(
					"min-w-0",
					row.op === "onlyA" && "border-series-1 border-l-2 bg-control-bg",
					row.op === "onlyB" && "bg-container-content-bg",
				)}
			>
				<StepCell
					side="a"
					index={row.a ?? 0}
					step={row.a === null ? undefined : stepsA.get(row.a)}
					onOpen={onOpen}
				/>
			</div>
			<Connector op={row.op} />
			<div
				className={cn(
					"min-w-0",
					row.op === "onlyB" && "border-series-6 border-r-2 bg-control-bg",
					row.op === "onlyA" && "bg-container-content-bg",
				)}
			>
				<StepCell
					side="b"
					index={row.b ?? 0}
					step={row.b === null ? undefined : stepsB.get(row.b)}
					onOpen={onOpen}
				/>
			</div>
		</div>
	);
}

function turnLine(
	t: Translator,
	turn: { n: number; label: string; trigger: string } | null,
): string {
	if (!turn) return "";
	if (turn.trigger !== "prompt" || !turn.label)
		return t("sessionInsights.compare.turnPlain", { n: turn.n });
	return t("sessionInsights.compare.turnPrompt", { n: turn.n, prompt: turn.label });
}

export function ItemLine({
	item,
	loaded,
	onOpen,
	onUnfold,
}: {
	item: AlignItem;
	loaded: LoadedAlignment;
	onOpen: (side: Side, step: AlignStep) => void;
	onUnfold: (key: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	if (item.kind === "row")
		return <RowLine row={item.row} stepsA={loaded.stepsA} stepsB={loaded.stepsB} onOpen={onOpen} />;
	if (item.kind === "fold") {
		const steps = item.side === "a" ? loaded.stepsA : loaded.stepsB;
		const indices = item.rows.map((row) => (item.side === "a" ? row.a : row.b) ?? 0);
		const names = new Map<string, number>();
		for (const index of indices) {
			const klass = steps.get(index)?.klass ?? "";
			names.set(klass, (names.get(klass) ?? 0) + 1);
		}
		const summary = [...names.entries()]
			.map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
			.join(", ");
		const button = (
			<button
				type="button"
				data-testid="align-fold"
				onClick={() => onUnfold(item.key)}
				className={cn(
					"flex h-full w-full min-w-0 items-center gap-6 px-8 text-left tr-text-metadata text-text-muted hover:bg-control-bg-hovered focus-visible:focus-ring-inset",
					item.side === "a" ? "border-series-1 border-l-2" : "border-series-6 border-r-2",
				)}
			>
				<span className="w-32 shrink-0 text-right tr-code-text-small text-text-subtle">
					{(indices[0] ?? 0) + 1}–{(indices.at(-1) ?? 0) + 1}
				</span>
				<RiMore2Line aria-hidden className="size-14 shrink-0" />
				<span className="min-w-0 flex-1 truncate">
					{t(
						item.side === "a" ? "sessionInsights.compare.foldA" : "sessionInsights.compare.foldB",
						{
							count: item.rows.length,
							names: summary,
						},
					)}
				</span>
			</button>
		);
		return (
			<div className="grid h-28 grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] border-border-muted border-b bg-control-bg">
				{item.side === "a" ? button : <span className="bg-container-content-bg" />}
				<span aria-hidden />
				{item.side === "b" ? button : <span className="bg-container-content-bg" />}
			</div>
		);
	}
	const head = (side: Side, turn: typeof item.a) => (
		<span className="flex min-w-0 items-center gap-6 px-8">
			{turn ? <SidePill side={side} /> : null}
			<span className="min-w-0 flex-1 truncate">{turnLine(t, turn)}</span>
			{turn ? (
				<span className="shrink-0 text-text-subtle">
					{t("sessionInsights.compare.calls", { count: turn.calls })} ·{" "}
					{formatDuration(t, turn.durationMs)}
				</span>
			) : null}
		</span>
	);
	return (
		<div
			data-testid="align-turn-header"
			data-paired={item.pair !== null}
			className="grid h-32 grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center border-border-default border-y bg-container-header-bg tr-text-metadata text-text-muted"
		>
			{head("a", item.a)}
			<span className="flex justify-center text-text-subtle">
				{item.pair ? (
					<span
						title={t("sessionInsights.compare.pairTitle", {
							share: formatPercent(locale, item.pair.similarity),
						})}
					>
						↔
					</span>
				) : null}
			</span>
			{head("b", item.b)}
		</div>
	);
}

function Notice({ testId, children }: { testId: string; children: ReactNode }) {
	return (
		<div
			data-testid={testId}
			role="alert"
			className="flex flex-col items-center justify-center gap-8 p-16 text-center tr-text-ui text-text-muted"
		>
			{children}
		</div>
	);
}

/**
 * Two sessions side by side: their header cards, a strip of both sessions' turns with the pairs, and
 * their calls in two columns aligned by the server (`=` the same action, `≈` the same kind, one-sided
 * calls tinted on their side). A call opens in its session's analysis tab.
 */
export default function ComparePanel({ host, params }: PanelProps) {
	const t = useT();
	const locale = localeOf(t);
	const a = params.a ?? "";
	const b = params.b ?? "";
	const [attempt, setAttempt] = useState(0);
	const [differences, setDifferences] = useState(false);
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const summaryA = useSummary(host, a, attempt);
	const summaryB = useSummary(host, b, attempt);
	const alignment = useAlignment(host, a, b, attempt);
	if (!hostServesThisVersion(host))
		return <Notice testId="session-insights-update-host">{t("sessionInsights.updateHost")}</Notice>;
	if (alignment.kind === "version" || summaryA.kind === "version" || summaryB.kind === "version")
		return <Notice testId="session-insights-update-host">{t("sessionInsights.updateHost")}</Notice>;
	const failed =
		alignment.kind === "failed" || summaryA.kind === "failed" || summaryB.kind === "failed";
	const missing =
		(alignment.kind === "ready" && alignment.value === null) ||
		(summaryA.kind === "ready" && !summaryA.value.session && !summaryA.value.pending) ||
		(summaryB.kind === "ready" && !summaryB.value.session && !summaryB.value.pending);
	const loaded = alignment.kind === "ready" && alignment.value !== PENDING ? alignment.value : null;
	const onOpen = (side: Side, step: AlignStep) => {
		const summary = side === "a" ? summaryA : summaryB;
		const session = summary.kind === "ready" ? summary.value.session : null;
		const sessionId = side === "a" ? a : b;
		requestSessionFocus(sessionId, step.eventId);
		host.openPanel(SESSION_PANEL, { sessionId }, session ? sessionName(t, session) : sessionId);
	};
	const items = loaded
		? alignItems(loaded.alignment, loaded.rows, loaded.stepsA, loaded.stepsB, { differences, open })
		: [];
	const card = (side: Side) => {
		const summary = side === "a" ? summaryA : summaryB;
		if (summary.kind !== "ready" || !summary.value.session)
			return (
				<LoadingRegion
					rows={2}
					label={t("sessionInsights.session.loading")}
					className="flex-1 p-8"
				/>
			);
		const turns = loaded
			? (side === "a" ? loaded.alignment.a : loaded.alignment.b).turns.length
			: null;
		return (
			<SessionCard
				side={side}
				session={summary.value.session}
				sources={summary.value.sources}
				turns={turns}
			/>
		);
	};
	return (
		<div data-testid="compare-panel" data-a={a} data-b={b} className="flex h-full min-h-0 flex-col">
			{failed ? (
				<Notice testId="compare-error">
					<span>{t("sessionInsights.error.failed")}</span>
					<Button variant="outline" size="m" onClick={() => setAttempt(attempt + 1)}>
						{t("common.retry")}
					</Button>
				</Notice>
			) : missing ? (
				<Notice testId="compare-missing">{t("sessionInsights.compare.missing")}</Notice>
			) : (
				<>
					<div className="flex shrink-0 flex-col gap-8 border-border-default border-b px-12 py-8">
						<div className="flex min-w-0 items-stretch gap-8">
							{card("a")}
							<span className="flex items-center text-text-subtle">
								<RiArrowLeftRightLine aria-hidden className="size-16" />
							</span>
							{card("b")}
						</div>
						{loaded ? <TurnStrip alignment={loaded.alignment} /> : null}
					</div>
					{loaded ? (
						<>
							<div className="flex shrink-0 flex-wrap items-center gap-x-12 gap-y-4 border-border-default border-b px-12 py-4 tr-text-metadata text-text-muted">
								<span data-testid="compare-similarity">
									{t("sessionInsights.compare.similarity", {
										share: formatPercent(locale, loaded.alignment.similarity),
										matched: formatCount(
											locale,
											loaded.alignment.totals.same + loaded.alignment.totals.similar,
										),
										a: formatCount(locale, loaded.alignment.a.calls),
										b: formatCount(locale, loaded.alignment.b.calls),
									})}
								</span>
								<span
									data-testid="compare-legend"
									className="flex flex-wrap items-center gap-x-12 gap-y-2"
								>
									<span>
										{t("sessionInsights.compare.legend.same", {
											n: loaded.alignment.totals.same,
										})}
									</span>
									<span>
										{t("sessionInsights.compare.legend.similar", {
											n: loaded.alignment.totals.similar,
										})}
									</span>
									<span className="inline-flex items-center gap-4">
										<span aria-hidden className="inline-block h-12 w-2 bg-series-1" />
										{t("sessionInsights.compare.legend.onlyA", {
											n: loaded.alignment.totals.onlyA,
										})}
									</span>
									<span className="inline-flex items-center gap-4">
										<span aria-hidden className="inline-block h-12 w-2 bg-series-6" />
										{t("sessionInsights.compare.legend.onlyB", {
											n: loaded.alignment.totals.onlyB,
										})}
									</span>
								</span>
								<span className="ml-auto flex items-center gap-2">
									<ToggleSegment
										testid="compare-all-steps"
										label={t("sessionInsights.compare.allSteps")}
										active={!differences}
										onClick={() => setDifferences(false)}
									/>
									<ToggleSegment
										testid="compare-differences"
										label={t("sessionInsights.compare.differences")}
										active={differences}
										onClick={() => setDifferences(true)}
									/>
								</span>
							</div>
							<div data-testid="compare-columns" className="min-h-0 flex-1">
								<Virtuoso
									data={items}
									computeItemKey={(_, item) => item.key}
									itemContent={(_, item) => (
										<ItemLine
											item={item}
											loaded={loaded}
											onOpen={onOpen}
											onUnfold={(key) => setOpen(new Set(open).add(key))}
										/>
									)}
								/>
							</div>
							{loaded.complete ? null : (
								<span className="shrink-0 px-12 py-4 tr-text-metadata text-text-subtle">
									{t("sessionInsights.compare.loadingMore")}
								</span>
							)}
							{loaded.complete && loaded.newer ? (
								<div
									data-testid="compare-newer"
									role="status"
									className="flex shrink-0 items-center gap-8 border-border-default border-t px-12 py-4 tr-text-metadata text-text-muted"
								>
									<span className="min-w-0 truncate">{t("sessionInsights.compare.newer")}</span>
									<Button
										variant="ghost"
										size="s"
										data-testid="compare-reload"
										onClick={() => setAttempt(attempt + 1)}
									>
										{t("sessionInsights.session.reload")}
									</Button>
								</div>
							) : null}
						</>
					) : (
						<LoadingRegion
							rows={10}
							label={t("sessionInsights.compare.loading")}
							testId="compare-loading"
							className="p-16"
						/>
					)}
				</>
			)}
		</div>
	);
}
