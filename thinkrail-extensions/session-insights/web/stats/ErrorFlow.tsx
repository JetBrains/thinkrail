import { RiCornerDownRightLine, RiErrorWarningLine } from "@remixicon/react";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	Activity,
	FlowLink,
	FlowNode,
	FlowOutcome,
	FlowState,
	SessionRef,
	StatsSequences,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { sessionName } from "../copy";
import { formatCount, formatPercent } from "../format";
import { ShareBar } from "../ShareBar";
import { ACTIVITY_LOOK, OUTCOME_LOOK, STATE_LOOK } from "./activityLook";
import { ACTIVITY_LABEL, FLOW_OUTCOME_LABEL, FLOW_OUTCOME_SHORT, FLOW_STATE_LABEL } from "./copy";
import { type SequenceActions, Swatch } from "./TransitionMatrix";

const W = 900;
const H = 360;
const TOP = 28;
const BOTTOM = 8;
const NODE_W = 10;
const GAP = 8;
const X0 = 150;
const X1 = 640;
const OUTCOMES: readonly FlowOutcome[] = ["recovered", "later", "never", "ended"];

interface Placed {
	key: string;
	count: number;
	x: number;
	y: number;
	h: number;
}

function isActivity(key: string, column: number): key is Activity {
	return column === 0 && key in ACTIVITY_LOOK;
}

function fillOf(key: string, column: number, last: number): string {
	if (column === 0) return isActivity(key, column) ? ACTIVITY_LOOK[key].fill : "fill-series-8";
	if (column === last) return OUTCOME_LOOK[key as FlowOutcome]?.fill ?? "fill-series-8";
	return STATE_LOOK[key as FlowState]?.fill ?? "fill-series-8";
}

function strokeOf(link: FlowLink, last: number): { stroke: string; opacity: number } {
	const target = link.target;
	if (target === "recovered") return { stroke: "stroke-feedback-success", opacity: 0.45 };
	if (target === "repeatFailed" || target === "otherError")
		return { stroke: "stroke-feedback-error", opacity: 0.35 };
	const passing = link.source === target && (target === "end" || target === "recovered");
	if (link.column === 0) {
		const look = isActivity(link.source, 0) ? ACTIVITY_LOOK[link.source].stroke : "stroke-series-8";
		return { stroke: look, opacity: 0.3 };
	}
	if (link.column + 1 === last)
		return {
			stroke: STATE_LOOK[link.source as FlowState]?.stroke ?? "stroke-series-8",
			opacity: 0.25,
		};
	return {
		stroke: STATE_LOOK[link.source as FlowState]?.stroke ?? "stroke-series-8",
		opacity: passing ? 0.18 : 0.28,
	};
}

function labelOf(t: Translator, key: string, column: number, last: number, steps: number): string {
	if (column === 0) return isActivity(key, column) ? t(ACTIVITY_LABEL[key]) : key;
	if (column === last) return t(FLOW_OUTCOME_LABEL[key as FlowOutcome], { steps });
	return t(FLOW_STATE_LABEL[key as FlowState]);
}

/** Node boxes stacked per column, each column centred; heights scale with the failures through them. */
export function placeColumns(columns: readonly (readonly FlowNode[])[], total: number): Placed[][] {
	const most = Math.max(1, ...columns.map((column) => column.length));
	const scale = (H - TOP - BOTTOM - GAP * (most - 1)) / Math.max(1, total);
	return columns.map((column, at) => {
		const x = X0 + ((X1 - X0) * at) / Math.max(1, columns.length - 1);
		let y = TOP;
		const placed = column.map((node) => {
			const h = Math.max(2, node.count * scale);
			const item = { key: node.key, count: node.count, x, y, h };
			y += h + GAP;
			return item;
		});
		const shift = (H - BOTTOM - (y - GAP)) / 2;
		for (const item of placed) item.y += shift;
		return placed;
	});
}

interface FlowPath {
	key: string;
	d: string;
	width: number;
	stroke: string;
	opacity: number;
}

/** Each link as a band between its nodes, stacked inside the nodes in their columns' order. */
export function flowPaths(
	links: readonly FlowLink[],
	placed: readonly Placed[][],
	total: number,
): FlowPath[] {
	const last = placed.length - 1;
	const most = Math.max(1, ...placed.map((column) => column.length));
	const scale = (H - TOP - BOTTOM - GAP * (most - 1)) / Math.max(1, total);
	const paths: FlowPath[] = [];
	for (let column = 0; column < last; column++) {
		const from = placed[column] ?? [];
		const to = placed[column + 1] ?? [];
		const inColumn = links.filter((link) => link.column === column);
		const out = new Map<string, number>();
		const into = new Map<string, number>();
		const sourceIndex = (link: FlowLink) => from.findIndex((node) => node.key === link.source);
		const targetIndex = (link: FlowLink) => to.findIndex((node) => node.key === link.target);
		const starts = new Map<FlowLink, number>();
		for (const link of [...inColumn].sort(
			(a, b) => sourceIndex(a) - sourceIndex(b) || targetIndex(a) - targetIndex(b),
		)) {
			const node = from[sourceIndex(link)];
			if (!node) continue;
			const offset = out.get(link.source) ?? 0;
			starts.set(link, node.y + offset + (link.count * scale) / 2);
			out.set(link.source, offset + link.count * scale);
		}
		for (const link of [...inColumn].sort(
			(a, b) => targetIndex(a) - targetIndex(b) || sourceIndex(a) - sourceIndex(b),
		)) {
			const source = from[sourceIndex(link)];
			const target = to[targetIndex(link)];
			const start = starts.get(link);
			if (!source || !target || start === undefined) continue;
			const offset = into.get(link.target) ?? 0;
			const end = target.y + offset + (link.count * scale) / 2;
			into.set(link.target, offset + link.count * scale);
			const xa = source.x + NODE_W;
			const xb = target.x;
			const xm = (xa + xb) / 2;
			paths.push({
				key: `${column}:${link.source}:${link.target}`,
				d: `M${xa},${start.toFixed(1)} C${xm},${start.toFixed(1)} ${xm},${end.toFixed(1)} ${xb},${end.toFixed(1)}`,
				width: Math.max(1, link.count * scale),
				...strokeOf(link, last),
			});
		}
	}
	return paths;
}

/** Label baselines: each node's middle, pushed down so labels in one column never overlap. */
function labelRows(placed: readonly Placed[][], total: number): (number | null)[][] {
	const last = placed.length - 1;
	return placed.map((column, at) => {
		let previous = Number.NEGATIVE_INFINITY;
		const gap = at === last ? 28 : 14;
		return column.map((node) => {
			if (at !== 0 && at !== last && node.count / Math.max(1, total) < 0.03) return null;
			const y = Math.max(node.y + node.h / 2 + 4, previous + gap);
			previous = y;
			return y;
		});
	});
}

function FlowChart({ sequences }: { sequences: StatsSequences }) {
	const t = useT();
	const locale = localeOf(t);
	const { flow } = sequences;
	const steps = sequences.rules.flowSteps;
	const total = flow.failures;
	const last = flow.columns.length - 1;
	const placed = placeColumns(flow.columns, total);
	const paths = flowPaths(flow.links, placed, total);
	const rows = labelRows(placed, total);
	const heads = [
		t("sessionInsights.sequences.flow.failed"),
		...Array.from({ length: steps }, (_, at) =>
			t("sessionInsights.sequences.flow.step", { n: at + 1 }),
		),
		t("sessionInsights.sequences.flow.outcome"),
	];
	return (
		<svg
			data-testid="sequence-flow"
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={t("sessionInsights.sequences.flow.label", {
				count: total,
				failures: formatCount(locale, total),
			})}
			className="block h-auto w-full max-w-900"
		>
			{heads.map((head, column) => {
				const x = X0 + ((X1 - X0) * column) / Math.max(1, last);
				return (
					<text
						key={head}
						x={column === 0 ? x + NODE_W : x}
						y={14}
						textAnchor={column === 0 ? "end" : "start"}
						className="fill-text-subtle tr-text-caption uppercase"
					>
						{head}
					</text>
				);
			})}
			{paths.map((path) => (
				<path
					key={path.key}
					d={path.d}
					fill="none"
					strokeWidth={path.width}
					strokeOpacity={path.opacity}
					className={path.stroke}
				/>
			))}
			{placed.map((column, at) =>
				column.map((node) => (
					<rect
						key={`${at}:${node.key}`}
						data-testid="sequence-flow-node"
						data-column={at}
						data-key={node.key}
						x={node.x}
						y={node.y}
						width={NODE_W}
						height={node.h}
						rx={2}
						className={fillOf(node.key, at, last)}
					/>
				)),
			)}
			{placed.map((column, at) =>
				column.map((node, index) => {
					const y = rows[at]?.[index] ?? null;
					if (y === null) return null;
					const label = labelOf(t, node.key, at, last, steps);
					if (at === 0)
						return (
							<text
								key={`label:${at}:${node.key}`}
								x={node.x - 6}
								y={y}
								textAnchor="end"
								className="fill-text-default tr-text-metadata"
							>
								{label}
								<tspan className="fill-text-muted"> ✕ {formatCount(locale, node.count)}</tspan>
							</text>
						);
					if (at === last)
						return (
							<text
								key={`label:${at}:${node.key}`}
								data-testid="sequence-flow-outcome"
								data-key={node.key}
								x={node.x + NODE_W + 6}
								y={y - 4}
								className="fill-text-default tr-text-metadata"
							>
								{label}
								<tspan
									x={node.x + NODE_W + 6}
									dy={14}
									className="fill-text-muted tr-code-text-small"
								>
									{formatCount(locale, node.count)} · {formatPercent(locale, node.count / total)}
								</tspan>
							</text>
						);
					return (
						<text
							key={`label:${at}:${node.key}`}
							x={node.x + NODE_W + 4}
							y={y}
							className="fill-text-default tr-text-metadata"
						>
							{label}
							<tspan className="fill-text-muted"> {formatCount(locale, node.count)}</tspan>
						</text>
					);
				}),
			)}
		</svg>
	);
}

/** Variant C: the next steps after a failed call, how failures ended, and what fails most. */
export function ErrorFlow({
	result,
	actions,
}: {
	result: { sequences: StatsSequences; sessions: readonly SessionRef[] };
	actions: SequenceActions;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { sequences, sessions } = result;
	const { flow } = sequences;
	const steps = sequences.rules.flowSteps;
	if (flow.failures === 0)
		return (
			<p data-testid="sequence-flow-empty" className="p-16 text-center tr-text-ui text-text-muted">
				{t("sessionInsights.sequences.flow.empty")}
			</p>
		);
	const example = flow.example;
	const exampleSession = example ? sessions[example.session] : undefined;
	return (
		<div data-testid="sequence-errors" className="flex min-w-0 flex-col gap-12">
			<div className="flex flex-wrap items-center gap-x-12 gap-y-4 tr-text-metadata text-text-muted">
				<span data-testid="sequence-flow-summary">
					{t("sessionInsights.sequences.flow.summary", {
						failures: t("sessionInsights.sequences.flow.failedCalls", {
							count: flow.failures,
							n: formatCount(locale, flow.failures),
						}),
						inSessions: t("sessionInsights.sequences.inSessions", {
							count: flow.sessions,
							n: formatCount(locale, flow.sessions),
						}),
						share: formatPercent(locale, sequences.failed / Math.max(1, sequences.calls), 1),
						ofCalls: t("sessionInsights.sequences.ofCalls", {
							count: sequences.calls,
							n: formatCount(locale, sequences.calls),
						}),
					})}
				</span>
				<span className="ml-auto inline-flex items-center gap-4">
					<span aria-hidden className="inline-block size-8 rounded-sm bg-feedback-success" />
					{t("sessionInsights.sequences.flow.toRecovery")}
				</span>
				<span className="inline-flex items-center gap-4">
					<span aria-hidden className="inline-block size-8 rounded-sm bg-feedback-error" />
					{t("sessionInsights.sequences.flow.toError")}
				</span>
				<span className="text-text-subtle">{t("sessionInsights.sequences.flow.otherFlows")}</span>
			</div>
			<FlowChart sequences={sequences} />
			<p className="tr-text-metadata text-text-subtle">
				{t("sessionInsights.sequences.flow.note", {
					share: formatPercent(locale, sequences.rules.flowRareShare, 1),
				})}
			</p>
			<div className="grid min-w-0 grid-cols-1 gap-12 @[56rem]:grid-cols-2">
				<section className="flex min-w-0 flex-col gap-4 rounded-md border border-border-default p-12">
					<h4 className="flex flex-wrap items-center gap-8 tr-title-compact text-text-default">
						{t("sessionInsights.sequences.failing.title")}
						<span className="ml-auto flex flex-wrap items-center gap-8 font-normal tr-text-caption text-text-muted">
							{OUTCOMES.map((outcome) => (
								<span key={outcome} className="inline-flex items-center gap-4">
									<span
										aria-hidden
										className={cn("inline-block size-8 rounded-sm", OUTCOME_LOOK[outcome].bg)}
									/>
									{t(FLOW_OUTCOME_SHORT[outcome], { steps })}
								</span>
							))}
						</span>
					</h4>
					<table className="w-full table-fixed border-collapse tr-text-ui">
						<colgroup>
							<col />
							<col className="w-56" />
							<col className="w-120" />
							<col className="w-56" />
						</colgroup>
						<thead>
							<tr className="tr-text-caption text-text-subtle">
								<th scope="col" className="py-2 text-left font-normal">
									{t("sessionInsights.sequences.failing.call")}
								</th>
								<th scope="col" className="py-2 text-right font-normal">
									{t("sessionInsights.sequences.failing.failed")}
								</th>
								<th scope="col" className="px-8 py-2 text-left font-normal">
									{t("sessionInsights.sequences.failing.outcome")}
								</th>
								<th scope="col" className="py-2 text-right font-normal">
									{t("sessionInsights.sequences.failing.recovered", { steps })}
								</th>
							</tr>
						</thead>
						<tbody>
							{flow.failing.map((row) => (
								<tr
									key={`${row.tool}:${row.key}`}
									data-testid="sequence-failing-row"
									data-key={row.key}
									className="border-border-muted border-t"
								>
									<td className="max-w-0 py-2">
										<button
											type="button"
											onClick={() =>
												actions.onShowSessions(
													row.key,
													row.sessions.flatMap((index) => sessions[index]?.sessionId ?? []),
												)
											}
											className="flex w-full min-w-0 items-center gap-6 rounded-sm text-left hover:underline focus-visible:focus-ring"
										>
											<Swatch activity={row.activity} />
											<span className="truncate tr-code-text-small text-text-default">
												{row.tool === row.key ? row.key : `${row.tool} ${row.key}`}
											</span>
										</button>
									</td>
									<td className="py-2 text-right tabular-nums">
										{formatCount(locale, row.failures)}
									</td>
									<td className="px-8 py-2">
										<ShareBar
											total={row.failures}
											parts={OUTCOMES.map((outcome) => ({
												key: outcome,
												value: row.outcomes[outcome],
												fill: OUTCOME_LOOK[outcome].fill,
											}))}
										/>
									</td>
									<td className="py-2 text-right text-feedback-success tabular-nums">
										{formatPercent(locale, row.outcomes.recovered / row.failures)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
				{example && exampleSession ? (
					<section
						data-testid="sequence-flow-example"
						className="flex min-w-0 flex-col gap-4 rounded-md border border-border-default p-12"
					>
						<h4 className="flex min-w-0 items-center gap-8 tr-title-compact text-text-default">
							<span className="shrink-0">{t("sessionInsights.sequences.flow.example")}</span>
							<span className="min-w-0 flex-1 truncate font-normal tr-text-metadata text-text-muted">
								{sessionName(t, exampleSession)}
							</span>
							<Button
								variant="ghost"
								size="s"
								iconLeft={RiCornerDownRightLine}
								data-testid="sequence-flow-open"
								onClick={() =>
									actions.onOpenSession(exampleSession, example.steps[0]?.eventId ?? null)
								}
							>
								{t("sessionInsights.sequences.openInTrace")}
							</Button>
						</h4>
						<ol className="flex min-w-0 flex-col gap-2">
							{example.steps.map((step) => (
								<li key={step.eventId}>
									<button
										type="button"
										data-state={step.state ?? "failed"}
										onClick={() => actions.onOpenSession(exampleSession, step.eventId)}
										className={cn(
											"flex w-full min-w-0 items-center gap-6 rounded-sm px-6 py-2 text-left focus-visible:focus-ring",
											step.failed
												? "bg-feedback-error-subtle"
												: step.state === "recovered"
													? "bg-feedback-success-subtle"
													: "hover:bg-control-bg-hovered",
										)}
									>
										<span
											className={cn(
												"w-96 shrink-0 truncate tr-text-caption uppercase",
												step.failed
													? "text-feedback-error"
													: step.state === "recovered"
														? "text-feedback-success"
														: "text-text-subtle",
											)}
										>
											{step.state === null
												? t("sessionInsights.sequences.flow.failedStep")
												: t(FLOW_STATE_LABEL[step.state])}
										</span>
										<Swatch activity={step.activity} />
										<span className="shrink-0 tr-code-text-small text-text-default">
											{step.tool}
										</span>
										<span className="min-w-0 flex-1 truncate tr-code-text-small text-text-subtle">
											{step.label}
										</span>
										{step.failed ? (
											<RiErrorWarningLine
												aria-label={t("sessionInsights.sequences.failed")}
												className="size-12 shrink-0 text-feedback-error"
											/>
										) : step.missing ? (
											<span className="shrink-0 tr-text-caption text-text-muted">
												{t("sessionInsights.trace.noResult")}
											</span>
										) : null}
									</button>
								</li>
							))}
						</ol>
					</section>
				) : null}
			</div>
		</div>
	);
}
