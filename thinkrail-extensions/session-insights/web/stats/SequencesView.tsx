import { localeOf, useT } from "@thinkrail/locales/react";
import type { StatsSequencesResult } from "@thinkrail/pi-session-insights/core";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { lazy, Suspense, useState } from "react";
import { formatCount, formatPercent } from "../format";
import { ACTIVITY_LOOK } from "./activityLook";
import { ACTIVITY_LABEL } from "./copy";
import { ErrorFlow } from "./ErrorFlow";
import { type SequenceActions, Swatch, TransitionMatrix } from "./TransitionMatrix";

const ProcessMap = lazy(() => import("./ProcessMap"));

/** The matrix, the process map, or what follows a failed call. */
export type SequenceView = "matrix" | "map" | "errors";

const VIEWS = [
	{ id: "matrix", label: "sessionInsights.sequences.view.matrix" },
	{ id: "map", label: "sessionInsights.sequences.view.map" },
	{ id: "errors", label: "sessionInsights.sequences.view.errors" },
] as const;

function MapSection({ result }: { result: StatsSequencesResult }) {
	const t = useT();
	const locale = localeOf(t);
	const { sequences } = result;
	const shares = sequences.rules.edgeShares;
	const [share, setShare] = useState<number>(shares[1] ?? shares[0] ?? 0.02);
	const threshold = sequences.thresholds.find((entry) => entry.share === share);
	return (
		<div data-testid="sequence-map" className="flex min-w-0 flex-col gap-8">
			<div className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
				<span>{t("sessionInsights.sequences.map.threshold")}</span>
				<span className="flex items-center gap-2">
					{shares.map((value) => (
						<ToggleSegment
							key={value}
							testid={`sequence-edge-${value}`}
							label={t("sessionInsights.sequences.map.atLeast", {
								share: formatPercent(locale, value),
							})}
							active={share === value}
							onClick={() => setShare(value)}
						/>
					))}
				</span>
				{threshold ? (
					<span data-testid="sequence-map-hidden" className="ml-auto text-text-subtle">
						{t("sessionInsights.sequences.map.hidden", {
							count: threshold.hiddenEdges,
							min: formatCount(locale, threshold.min),
							transitions: formatCount(locale, threshold.hiddenTransitions),
							share: formatPercent(
								locale,
								threshold.hiddenTransitions / Math.max(1, sequences.transitions),
							),
						})}
					</span>
				) : null}
			</div>
			<Suspense
				fallback={
					<LoadingRegion
						rows={6}
						label={t("sessionInsights.sequences.map.loading")}
						testId="sequence-map-loading"
						className="h-480 p-16"
					/>
				}
			>
				<ProcessMap sequences={sequences} share={share} />
			</Suspense>
			<div className="flex flex-wrap items-center gap-x-12 gap-y-4 tr-text-metadata text-text-muted">
				<span>{t("sessionInsights.sequences.map.legendEdge")}</span>
				<span>{t("sessionInsights.sequences.map.legendLoop")}</span>
				<span>{t("sessionInsights.sequences.map.legendStarts")}</span>
				<span className="text-feedback-error">
					{t("sessionInsights.sequences.map.legendError", {
						share: formatPercent(locale, sequences.rules.errorMarkShare),
					})}
				</span>
			</div>
			{threshold && threshold.hiddenNodes.length > 0 ? (
				<div className="flex flex-wrap items-center gap-4 tr-text-metadata text-text-subtle">
					<span>{t("sessionInsights.sequences.map.hiddenNodes")}</span>
					{threshold.hiddenNodes.map((activity) => {
						const node = sequences.nodes.find((entry) => entry.activity === activity);
						return (
							<span
								key={activity}
								data-testid="sequence-hidden-node"
								className="inline-flex items-center gap-4 rounded-sm border border-border-default border-dashed px-6"
							>
								<Swatch activity={activity} />
								{t(ACTIVITY_LABEL[activity])} {formatCount(locale, node?.calls ?? 0)}
							</span>
						);
					})}
				</div>
			) : null}
			<section className="flex min-w-0 flex-col gap-4">
				<h4 className="flex flex-wrap items-baseline gap-8 tr-title-compact text-text-default">
					{t("sessionInsights.sequences.chains.title")}
					<span className="font-normal tr-text-metadata text-text-muted">
						{t("sessionInsights.sequences.chains.note", {
							count: sequences.chainTotal,
							steps: sequences.rules.chainSteps,
							total: formatCount(locale, sequences.chainTotal),
						})}
					</span>
				</h4>
				<ol
					data-testid="sequence-chains"
					className="grid grid-cols-1 gap-x-16 @[48rem]:grid-cols-3"
				>
					{sequences.chains.map((chain) => (
						<li
							key={chain.activities.join(">")}
							data-testid="sequence-chain"
							className="flex min-w-0 items-center gap-4 border-border-muted border-b py-2 tr-text-metadata"
						>
							{chain.activities.map((activity, at) => (
								<span key={`${activity}:${at}`} className="inline-flex items-center gap-4">
									{at > 0 ? <span className="text-text-subtle">→</span> : null}
									<span className={cn("whitespace-nowrap", ACTIVITY_LOOK[activity].text)}>
										{t(ACTIVITY_LABEL[activity])}
									</span>
								</span>
							))}
							<span className="ml-auto tr-code-text-small text-text-default">
								{formatCount(locale, chain.count)}
							</span>
							<span className="w-40 text-right tr-code-text-small text-text-subtle">
								{formatPercent(locale, chain.share, 1)}
							</span>
						</li>
					))}
				</ol>
			</section>
		</div>
	);
}

/**
 * Action sequences across the scope's sessions behind one switch: a transition matrix, a process map
 * and what follows a failed call. Every count is the server's.
 */
export function SequencesView({
	result,
	actions,
	initialView = "matrix",
	onView,
}: {
	result: StatsSequencesResult;
	actions: SequenceActions;
	initialView?: SequenceView;
	onView?: (view: SequenceView) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [view, setView] = useState<SequenceView>(initialView);
	const show = (next: SequenceView) => {
		setView(next);
		onView?.(next);
	};
	const { sequences } = result;
	return (
		<div data-testid="sequences-view" data-view={view} className="@container flex min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-8 border-border-default border-b px-12 py-4">
				<span data-testid="sequences-scope" className="tr-text-metadata text-text-muted">
					{t("sessionInsights.sequences.scope", {
						sessions: t("sessionInsights.sequences.scopeSessions", {
							count: sequences.sessionsWithCalls,
							n: formatCount(locale, sequences.sessionsWithCalls),
						}),
						calls: t("sessionInsights.sequences.scopeCalls", {
							count: sequences.calls,
							n: formatCount(locale, sequences.calls),
						}),
						transitions: t("sessionInsights.sequences.scopeTransitions", {
							count: sequences.transitions,
							n: formatCount(locale, sequences.transitions),
						}),
					})}
				</span>
				<fieldset
					aria-label={t("sessionInsights.sequences.viewLabel")}
					className="ml-auto flex items-center gap-2"
				>
					{VIEWS.map((item) => (
						<ToggleSegment
							key={item.id}
							testid={`sequences-view-${item.id}`}
							label={t(item.label)}
							active={view === item.id}
							onClick={() => show(item.id)}
						/>
					))}
				</fieldset>
			</div>
			{sequences.calls === 0 ? (
				<p data-testid="sequences-empty" className="p-16 text-center tr-text-ui text-text-muted">
					{t("sessionInsights.sequences.empty")}
				</p>
			) : (
				<div className="flex min-w-0 flex-col gap-8 p-12">
					{view === "matrix" ? (
						<TransitionMatrix result={result} actions={actions} />
					) : view === "map" ? (
						<MapSection result={result} />
					) : (
						<ErrorFlow result={result} actions={actions} />
					)}
				</div>
			)}
		</div>
	);
}
