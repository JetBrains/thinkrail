import { RiCornerDownRightLine, RiErrorWarningLine, RiFilter3Line } from "@remixicon/react";
import { localeOf, useT } from "@thinkrail/locales/react";
import type {
	Activity,
	SequenceCell,
	SessionRef,
	StatsSequences,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, useState } from "react";
import { sessionName } from "../copy";
import { formatCount, formatPercent, formatTokens } from "../format";
import { type GridCell, gridAttributes, gridMove, gridPosition } from "../grid";
import { ShareBar } from "../ShareBar";
import { ACTIVITY_LOOK } from "./activityLook";
import { ACTIVITY_LABEL } from "./copy";
import { ThresholdSlider } from "./ThresholdSlider";

export type MatrixMode = "share" | "count";

export interface SequenceActions {
	onOpenSession: (session: SessionRef, eventId: string | null) => void;
	onShowSessions: (label: string, ids: readonly string[]) => void;
}

const RAMP = ["bg-ramp-1", "bg-ramp-2", "bg-ramp-3", "bg-ramp-4"] as const;

/** The colour step of a cell: its row share, or its count against the largest cell. */
function rampOf(cell: SequenceCell, mode: MatrixMode, max: number): string {
	const value = mode === "share" ? cell.share : cell.count / Math.max(1, max);
	if (value >= 0.6) return RAMP[3];
	if (value >= 0.3) return RAMP[2];
	if (value >= 0.12) return RAMP[1];
	return RAMP[0];
}

export function Swatch({ activity, className }: { activity: Activity; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-block size-8 shrink-0 rounded-sm",
				ACTIVITY_LOOK[activity].bg,
				className,
			)}
		/>
	);
}

function cellKey(source: Activity, target: Activity): string {
	return `${source}>${target}`;
}

/** The most frequent cell, the matrix's first selection. */
export function largestCell(sequences: StatsSequences): SequenceCell | null {
	let best: SequenceCell | null = null;
	for (const cell of sequences.cells) if (!best || cell.count > best.count) best = cell;
	return best;
}

function CellDetail({
	cell,
	sequences,
	sessions,
	actions,
}: {
	cell: SequenceCell;
	sequences: StatsSequences;
	sessions: readonly SessionRef[];
	actions: SequenceActions;
}) {
	const t = useT();
	const locale = localeOf(t);
	const row = sequences.cells.filter((entry) => entry.source === cell.source);
	const total = row.reduce((sum, entry) => sum + entry.count, 0);
	const leading = [...row].sort((a, b) => b.count - a.count).slice(0, 4);
	const source = t(ACTIVITY_LABEL[cell.source]);
	const target = t(ACTIVITY_LABEL[cell.target]);
	const label = t("sessionInsights.sequences.cellLabel", { source, target });
	const exampleSession = cell.example ? sessions[cell.example.session] : undefined;
	const more = cell.sessions.length - cell.top.length;
	return (
		<aside
			data-testid="sequence-detail"
			data-source={cell.source}
			data-target={cell.target}
			className="flex w-288 min-w-0 max-w-full flex-col gap-12 rounded-md border border-border-default bg-container-sidebar-bg p-12"
		>
			<h4 className="flex min-w-0 items-center gap-6 tr-title-compact text-text-default">
				<Swatch activity={cell.source} />
				<span className="truncate">{source}</span>
				<span className="text-text-subtle">→</span>
				<Swatch activity={cell.target} />
				<span className="truncate">{target}</span>
			</h4>
			<dl className="grid grid-cols-2 gap-4">
				{[
					{
						key: "transitions",
						label: t("sessionInsights.sequences.kpi.transitions"),
						value: formatCount(locale, cell.count),
					},
					{
						key: "share",
						label: t("sessionInsights.sequences.kpi.share"),
						value: formatPercent(locale, cell.share, 1),
					},
					{
						key: "sessions",
						label: t("sessionInsights.sequences.kpi.sessions"),
						value: formatCount(locale, cell.sessions.length),
					},
					{
						key: "afterError",
						label: t("sessionInsights.sequences.kpi.afterError"),
						value: `${formatCount(locale, cell.afterError)} · ${formatPercent(locale, cell.afterError / cell.count, 1)}`,
					},
				].map((kpi) => (
					<div
						key={kpi.key}
						data-testid={`sequence-kpi-${kpi.key}`}
						className="flex min-w-0 flex-col rounded-sm border border-border-muted px-8 py-4"
					>
						<dt className="truncate tr-text-caption text-text-subtle">{kpi.label}</dt>
						<dd className="truncate tr-text-ui text-text-default tabular-nums">{kpi.value}</dd>
					</div>
				))}
			</dl>
			<div className="flex min-w-0 flex-col gap-4">
				<span className="tr-text-caption text-text-subtle">
					{t("sessionInsights.sequences.whereNext", { source })}
				</span>
				<ShareBar
					total={total}
					parts={row.map((entry) => ({
						key: entry.target,
						value: entry.count,
						fill: ACTIVITY_LOOK[entry.target].fill,
					}))}
				/>
				<span className="flex flex-wrap gap-x-8 gap-y-2 tr-text-metadata text-text-muted">
					{leading.map((entry) => (
						<span key={entry.target} className="inline-flex items-center gap-4">
							<Swatch activity={entry.target} />
							{t(ACTIVITY_LABEL[entry.target])}
							<span className="text-text-default tabular-nums">
								{formatPercent(locale, entry.share)}
							</span>
						</span>
					))}
				</span>
			</div>
			<div className="flex min-w-0 flex-col gap-2">
				<span className="tr-text-caption text-text-subtle">
					{t("sessionInsights.sequences.whereMost")}
				</span>
				<ul data-testid="sequence-sessions" className="flex min-w-0 flex-col">
					{cell.top.map((entry) => {
						const session = sessions[entry.session];
						if (!session) return null;
						return (
							<li key={entry.session}>
								<button
									type="button"
									data-testid="sequence-session"
									data-session-id={session.sessionId}
									onClick={() => actions.onOpenSession(session, entry.eventId || null)}
									className="flex w-full min-w-0 items-center gap-6 rounded-sm px-4 py-2 text-left tr-text-ui hover:bg-control-bg-hovered focus-visible:focus-ring"
								>
									<span className="min-w-0 flex-1 truncate text-text-default">
										{sessionName(t, session)}
									</span>
									<span className="shrink-0 tr-code-text-small text-text-subtle">
										×{formatCount(locale, entry.count)}
									</span>
									<RiCornerDownRightLine aria-hidden className="size-12 shrink-0 text-text-muted" />
								</button>
							</li>
						);
					})}
				</ul>
				<span className="flex items-center gap-8 tr-text-metadata text-text-subtle">
					{more > 0 ? t("sessionInsights.sequences.moreSessions", { count: more }) : null}
					<Button
						variant="ghost"
						size="s"
						iconLeft={RiFilter3Line}
						data-testid="sequence-show-sessions"
						onClick={() =>
							actions.onShowSessions(
								label,
								cell.sessions.flatMap((index) => sessions[index]?.sessionId ?? []),
							)
						}
					>
						{t("sessionInsights.findings.showSessions")}
					</Button>
				</span>
			</div>
			{cell.example && exampleSession ? (
				<div className="flex min-w-0 flex-col gap-2">
					<span className="truncate tr-text-caption text-text-subtle">
						{t("sessionInsights.sequences.example", { session: sessionName(t, exampleSession) })}
					</span>
					<ol
						data-testid="sequence-example"
						className="flex min-w-0 flex-col rounded-sm border border-border-muted bg-container-content-bg py-2"
					>
						{cell.example.steps.map((step) => (
							<li key={step.eventId}>
								<button
									type="button"
									data-testid="sequence-example-step"
									data-pair={step.pair}
									onClick={() => actions.onOpenSession(exampleSession, step.eventId)}
									className={cn(
										"flex w-full min-w-0 items-center gap-6 px-8 py-2 text-left hover:bg-control-bg-hovered focus-visible:focus-ring-inset",
										step.pair && "bg-control-bg-selected",
									)}
								>
									<Swatch activity={step.activity} />
									<span className="shrink-0 tr-code-text-small text-text-default">{step.tool}</span>
									<span className="min-w-0 flex-1 truncate tr-code-text-small text-text-subtle">
										{step.label}
									</span>
									{step.failed ? (
										<RiErrorWarningLine
											aria-label={t("sessionInsights.sequences.failed")}
											className="size-12 shrink-0 text-feedback-error"
										/>
									) : step.missing ? (
										<span
											data-testid="sequence-example-no-result"
											className="shrink-0 tr-text-caption text-text-muted"
										>
											{t("sessionInsights.trace.noResult")}
										</span>
									) : null}
								</button>
							</li>
						))}
					</ol>
				</div>
			) : null}
		</aside>
	);
}

/**
 * Variant A: which activity follows which, row-normalized, with loops outlined, a mark where failed
 * calls start ≥5% of a cell, and a frequency threshold that greys rare cells; a cell opens its sessions
 * and a real example.
 */
export function TransitionMatrix({
	result,
	actions,
	initial = null,
}: {
	result: { sequences: StatsSequences; sessions: readonly SessionRef[] };
	actions: SequenceActions;
	initial?: { source: Activity; target: Activity } | null;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { sequences, sessions } = result;
	const thresholds = sequences.rules.cellThresholds;
	const [step, setStep] = useState(0);
	const [mode, setMode] = useState<MatrixMode>("share");
	const [picked, setPicked] = useState<string | null>(
		initial ? cellKey(initial.source, initial.target) : null,
	);
	const [active, setActive] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
	const minimum = thresholds[step] ?? 1;
	const activities = sequences.activities;
	const byKey = new Map(sequences.cells.map((cell) => [cellKey(cell.source, cell.target), cell]));
	const largest = largestCell(sequences);
	const selected =
		(picked ? byKey.get(picked) : undefined) ??
		(largest ? byKey.get(cellKey(largest.source, largest.target)) : undefined) ??
		null;
	const max = largest?.count ?? 1;
	const widths = activities.map(() => activities.length);
	const cellOf = (row: number, col: number): GridCell => ({
		key: `${row}:${col}`,
		row,
		col,
		tabIndex: row === active.row && col === active.col ? 0 : -1,
	});
	const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
		if (!(event.target instanceof HTMLElement)) return;
		const position = gridPosition(event.target);
		if (!position) return;
		const next = gridMove(event.key, event.ctrlKey || event.metaKey, position, widths);
		if (!next) return;
		event.preventDefault();
		setActive(next);
		event.currentTarget
			.querySelector<HTMLElement>(`[data-grid-row="${next.row}"][data-grid-col="${next.col}"]`)
			?.focus();
	};
	return (
		<div data-testid="sequence-matrix" className="flex min-w-0 flex-col gap-8">
			<div className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
				<ThresholdSlider thresholds={thresholds} step={step} onStep={setStep} />
				<span className="ml-auto flex items-center gap-2">
					<ToggleSegment
						testid="sequence-mode-share"
						label={t("sessionInsights.sequences.mode.share")}
						active={mode === "share"}
						onClick={() => setMode("share")}
					/>
					<ToggleSegment
						testid="sequence-mode-count"
						label={t("sessionInsights.sequences.mode.count")}
						active={mode === "count"}
						onClick={() => setMode("count")}
					/>
				</span>
			</div>
			<div className="flex min-w-0 flex-wrap items-start gap-16">
				<div className="min-w-0 max-w-full overflow-x-auto">
					<table
						aria-label={t("sessionInsights.sequences.matrixLabel")}
						onKeyDown={onKeyDown}
						className="table-fixed border-collapse"
					>
						<colgroup>
							<col className="w-112" />
							{activities.map((activity) => (
								<col key={activity} className="w-88" />
							))}
							<col className="w-48" />
						</colgroup>
						<thead>
							<tr>
								<th
									scope="col"
									className="truncate text-left font-normal tr-text-caption text-text-subtle"
								>
									{t("sessionInsights.sequences.corner")}
								</th>
								{activities.map((activity) => (
									<th
										key={activity}
										scope="col"
										title={t(ACTIVITY_LABEL[activity])}
										className="truncate px-2 text-center font-normal tr-text-metadata text-text-muted"
									>
										<span className="inline-flex max-w-full items-center gap-2">
											<Swatch activity={activity} />
											<span className="truncate">{t(ACTIVITY_LABEL[activity])}</span>
										</span>
									</th>
								))}
								<th scope="col" className="text-right font-normal tr-text-caption text-text-subtle">
									{t("sessionInsights.sequences.sum")}
								</th>
							</tr>
						</thead>
						<tbody>
							{activities.map((source, row) => {
								const node = sequences.nodes.find((entry) => entry.activity === source);
								return (
									<tr key={source}>
										<th
											scope="row"
											className={cn(
												"truncate pr-4 text-right font-normal tr-text-metadata",
												selected?.source === source ? "text-feedback-info" : "text-text-default",
											)}
										>
											<span className="inline-flex max-w-full items-center gap-4">
												<Swatch activity={source} />
												<span className="truncate">{t(ACTIVITY_LABEL[source])}</span>
											</span>
										</th>
										{activities.map((target, col) => {
											const cell = byKey.get(cellKey(source, target));
											const grid = cellOf(row, col);
											if (!cell)
												return (
													<td key={target} className="p-2">
														<button
															type="button"
															{...gridAttributes(grid)}
															aria-disabled
															aria-label={t("sessionInsights.sequences.cellEmpty", {
																source: t(ACTIVITY_LABEL[source]),
																target: t(ACTIVITY_LABEL[target]),
															})}
															onFocus={() => setActive({ row, col })}
															className="block h-32 w-full rounded-sm focus-visible:focus-ring"
														/>
													</td>
												);
											const dim = cell.count < minimum;
											const loop = source === target;
											const isSelected = selected === cell;
											return (
												<td key={target} className="p-2">
													<button
														type="button"
														{...gridAttributes(grid)}
														data-testid="sequence-cell"
														data-source={source}
														data-target={target}
														data-loop={loop}
														data-dim={dim}
														data-error-mark={cell.errorMark && !dim}
														aria-pressed={isSelected}
														aria-label={t("sessionInsights.sequences.cellAria", {
															source: t(ACTIVITY_LABEL[source]),
															target: t(ACTIVITY_LABEL[target]),
															share: formatPercent(locale, cell.share),
															count: cell.count,
															n: formatCount(locale, cell.count),
														})}
														onFocus={() => setActive({ row, col })}
														onClick={() => setPicked(cellKey(source, target))}
														className={cn(
															"relative flex h-32 w-full min-w-0 flex-col items-center justify-center rounded-sm leading-none focus-visible:focus-ring",
															dim
																? "bg-control-bg text-text-subtle"
																: cn(rampOf(cell, mode, max), "text-text-default"),
															loop && !dim && "ring-1 ring-primary ring-inset",
															isSelected && "ring-2 ring-feedback-info ring-inset",
														)}
													>
														{dim ? null : (
															<span className="tr-code-text-small">
																{mode === "share"
																	? formatPercent(locale, cell.share)
																	: formatTokens(locale, cell.count)}
															</span>
														)}
														<span className="tr-text-caption">
															{mode === "share"
																? formatTokens(locale, cell.count)
																: dim
																	? formatTokens(locale, cell.count)
																	: formatPercent(locale, cell.share)}
														</span>
														{cell.errorMark && !dim ? (
															<span
																aria-hidden
																className="absolute top-2 right-2 size-6 rounded-full bg-feedback-error"
															/>
														) : null}
													</button>
												</td>
											);
										})}
										<td className="text-right tr-code-text-small text-text-muted">
											{formatTokens(locale, node?.transitions ?? 0)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					<div className="mt-8 flex flex-wrap items-center gap-x-12 gap-y-4 tr-text-metadata text-text-muted">
						<span className="inline-flex items-center gap-4">
							<span aria-hidden className="inline-block size-8 rounded-sm bg-ramp-3" />
							{t("sessionInsights.sequences.legend.share")}
						</span>
						<span className="inline-flex items-center gap-4">
							<span
								aria-hidden
								className="inline-block size-8 rounded-sm ring-1 ring-primary ring-inset"
							/>
							{t("sessionInsights.sequences.legend.loop")}
						</span>
						<span className="inline-flex items-center gap-4">
							<span aria-hidden className="inline-block size-6 rounded-full bg-feedback-error" />
							{t("sessionInsights.sequences.legend.afterError", {
								share: formatPercent(locale, sequences.rules.errorMarkShare),
							})}
						</span>
						<span className="text-text-subtle">{t("sessionInsights.sequences.legend.dim")}</span>
					</div>
				</div>
				{selected ? (
					<CellDetail cell={selected} sequences={sequences} sessions={sessions} actions={actions} />
				) : null}
			</div>
		</div>
	);
}
