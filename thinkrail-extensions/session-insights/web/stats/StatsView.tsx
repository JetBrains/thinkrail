import {
	type RemixiconComponentType,
	RiCoinsFill,
	RiCoinsLine,
	RiFireFill,
	RiFireLine,
	RiLightbulbFill,
	RiLightbulbLine,
	RiRouteFill,
	RiRouteLine,
	RiScales3Fill,
	RiScales3Line,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, useT } from "@thinkrail/locales/react";
import type { DigestProgress, IndexState, SessionRef } from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { type ReactNode, useId, useState } from "react";
import { formatCount } from "../format";
import type { InsightsSection } from "../listIntent";
import { listScope, type ScopeKind } from "../load";
import { Tabs, tabPanel } from "../Tabs";
import { type Polled, usePolled } from "../usePolled";
import type { StatsViewState } from "../viewState";
import { loadCompare, loadHotspots, loadSequences, loadUsage, stillReading } from "./api";
import { CompareView } from "./CompareView";
import { SECTION_LABEL } from "./copy";
import { FindingsBadge } from "./FindingsBadge";
import { FindingsView } from "./FindingsView";
import { HotspotsView } from "./HotspotsView";
import { SequencesView } from "./SequencesView";
import { UsageView } from "./UsageView";
import { type FindingsControls, tallyFindings } from "./useFindings";

const SECTIONS: readonly {
	id: InsightsSection;
	icon: RemixiconComponentType;
	active: RemixiconComponentType;
}[] = [
	{ id: "findings", icon: RiLightbulbLine, active: RiLightbulbFill },
	{ id: "usage", icon: RiCoinsLine, active: RiCoinsFill },
	{ id: "hotspots", icon: RiFireLine, active: RiFireFill },
	{ id: "sequences", icon: RiRouteLine, active: RiRouteFill },
	{ id: "ab", icon: RiScales3Line, active: RiScales3Fill },
];

const FAILURE_TEXT = {
	disabled: "sessionInsights.error.disabled",
	updateHost: "sessionInsights.updateHost",
	failed: "sessionInsights.error.failed",
} as const;

export interface StatsActions {
	onShowSessions: (label: string, ids: readonly string[]) => void;
	onOpenSession: (session: SessionRef, eventId: string | null) => void;
	onOpenFile: (workspaceId: string, path: string) => void;
}

function Progress({
	state,
	digests,
	busy,
}: {
	state: IndexState;
	digests: DigestProgress;
	busy: boolean;
}) {
	const t = useT();
	const locale = localeOf(t);
	if (stillReading({ state, digests })) {
		const label = t("sessionInsights.stats.reading", {
			ready: formatCount(locale, digests.ready),
			total: formatCount(locale, digests.total),
		});
		return (
			<span
				data-testid="stats-progress"
				className="flex min-w-0 items-center gap-8 tr-text-metadata text-text-muted"
			>
				<span className="truncate">{label}</span>
				<progress
					aria-label={label}
					className="h-2 w-64 shrink-0 accent-primary"
					max={Math.max(1, digests.total)}
					value={digests.ready}
				/>
			</span>
		);
	}
	if (busy)
		return (
			<span data-testid="stats-busy" className="tr-text-metadata text-text-subtle">
				{t("sessionInsights.stats.loading")}
			</span>
		);
	if (digests.stale > 0)
		return (
			<span data-testid="stats-updating" className="tr-text-metadata text-text-subtle">
				{t("sessionInsights.stats.updating", {
					count: digests.stale,
					n: formatCount(locale, digests.stale),
				})}
			</span>
		);
	return null;
}

function Body<T extends { state: IndexState; digests: DigestProgress }>({
	polled,
	onRetry,
	children,
}: {
	polled: { view: Polled<T>; busy: boolean };
	onRetry: () => void;
	children: (value: T, busy: boolean) => ReactNode;
}) {
	const t = useT();
	const { view, busy } = polled;
	switch (view.kind) {
		case "loading":
			return (
				<LoadingRegion
					rows={8}
					label={t("sessionInsights.stats.loading")}
					testId="stats-loading"
					className="p-16"
				/>
			);
		case "version":
			return (
				<p
					data-testid="session-insights-update-host"
					className="p-16 text-center tr-text-ui text-text-muted"
				>
					{t("sessionInsights.updateHost")}
				</p>
			);
		case "error":
			return (
				<div
					data-testid="stats-error"
					role="alert"
					className="flex flex-col items-center gap-8 p-16 text-center tr-text-ui text-text-muted"
				>
					<span>{t(FAILURE_TEXT[view.failure])}</span>
					{view.failure === "failed" ? (
						<Button variant="outline" size="m" onClick={onRetry}>
							{t("common.retry")}
						</Button>
					) : null}
				</div>
			);
		case "ready":
			return (
				<div aria-busy={busy} className="contents">
					<div className="flex justify-end px-12 pt-4">
						<Progress state={view.value.state} digests={view.value.digests} busy={busy} />
					</div>
					{children(view.value, busy)}
				</div>
			);
	}
}

/**
 * The Insights tab of the list panel: findings, usage and cost, file hotspots, action sequences and the
 * A/B slices over the scope's sessions, one section at a time behind a tab list. Every figure is the
 * server's; the panel polls while the sessions' facts are being read.
 */
export function StatsView({
	host,
	scopeKind,
	attempt,
	actions,
	findings,
	view,
	onView,
}: {
	host: PanelHost;
	scopeKind: ScopeKind;
	attempt: number;
	actions: StatsActions;
	/** The findings the panel asks for its Insights badge, shown here too. */
	findings: FindingsControls;
	view: StatsViewState;
	onView: (view: StatsViewState) => void;
}) {
	const t = useT();
	const tabsId = useId();
	const [retry, setRetry] = useState(0);
	const { section, hotspotSort: sort, slices: choice } = view;
	const scope = listScope(host, scopeKind);
	const base = `${scopeKind}:${host.scope.projectId}:${attempt}:${retry}`;
	const usage = usePolled(
		`usage:${base}`,
		section === "usage",
		(signal) => loadUsage(host, scope, signal),
		stillReading,
	);
	const hotspots = usePolled(
		`hotspots:${base}:${sort}`,
		section === "hotspots",
		(signal) => loadHotspots(host, scope, sort, signal),
		stillReading,
	);
	const sequences = usePolled(
		`sequences:${base}`,
		section === "sequences",
		(signal) => loadSequences(host, scope, signal),
		stillReading,
	);
	const compareKey = `${choice.by}\u0000${choice.a ?? ""}\u0000${choice.b ?? ""}`;
	const compare = usePolled(
		`compare:${base}:${compareKey}`,
		section === "ab",
		(signal) => loadCompare(host, scope, choice, signal),
		stillReading,
	);
	const again = () => setRetry((current) => current + 1);
	const tally =
		findings.polled.view.kind === "ready" ? tallyFindings(findings.polled.view.value) : null;
	return (
		<div data-testid="stats-view" className="flex min-h-0 flex-1 flex-col">
			<Tabs
				id={tabsId}
				label={t("sessionInsights.stats.sections")}
				tabs={SECTIONS.map((item) => {
					const Icon = item.id === section ? item.active : item.icon;
					return {
						id: item.id,
						testId: `stats-section-${item.id}`,
						label: (
							<>
								<Icon aria-hidden className="size-14" />
								{t(SECTION_LABEL[item.id])}
								{item.id === "findings" && tally ? (
									<FindingsBadge tally={tally} testId="stats-findings-badge" />
								) : null}
							</>
						),
					};
				})}
				value={section}
				onChange={(next) => onView({ ...view, section: next })}
				className="flex h-panel-header-row shrink-0 items-center gap-4 border-border-default border-b px-12"
				tabClassName="flex h-full items-center gap-4 px-4"
			/>
			<div {...tabPanel(tabsId, section)} className="@container min-h-0 flex-1 overflow-auto">
				{section === "findings" ? (
					<Body polled={findings.polled} onRetry={findings.retry}>
						{(value) => (
							<FindingsView
								result={value}
								onShowSessions={actions.onShowSessions}
								onOpenSession={actions.onOpenSession}
								onHide={findings.onHide}
							/>
						)}
					</Body>
				) : section === "usage" ? (
					<Body polled={usage} onRetry={again}>
						{(value) => (
							<UsageView
								result={value}
								onShowSessions={actions.onShowSessions}
								initialOptions={view.usage}
								onOptions={(usage) => onView({ ...view, usage })}
							/>
						)}
					</Body>
				) : section === "sequences" ? (
					<Body polled={sequences} onRetry={again}>
						{(value) => (
							<SequencesView
								result={value}
								actions={actions}
								initialView={view.sequences}
								onView={(sequences) => onView({ ...view, sequences })}
							/>
						)}
					</Body>
				) : section === "ab" ? (
					<Body polled={compare} onRetry={again}>
						{(value, busy) => (
							<CompareView
								result={value}
								busy={busy}
								choice={choice}
								onChoice={(slices) => onView({ ...view, slices })}
								actions={actions}
							/>
						)}
					</Body>
				) : (
					<Body polled={hotspots} onRetry={again}>
						{(value, busy) => (
							<HotspotsView
								result={value}
								busy={busy}
								sort={sort}
								onSort={(hotspotSort) => onView({ ...view, hotspotSort })}
								view={view.hotspotLayout}
								onView={(hotspotLayout) => onView({ ...view, hotspotLayout })}
								onShowSessions={actions.onShowSessions}
								onOpenSession={actions.onOpenSession}
								onOpenFile={actions.onOpenFile}
							/>
						)}
					</Body>
				)}
			</div>
		</div>
	);
}
