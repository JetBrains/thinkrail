import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, useT } from "@thinkrail/locales/react";
import type {
	DigestProgress,
	FindingsListResult,
	HotspotSort,
	IndexState,
	SessionRef,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { type ReactNode, useState } from "react";
import { formatCount } from "../format";
import { listScope, type ScopeKind } from "../load";
import { type Polled, usePolled } from "../usePolled";
import {
	hideFinding,
	loadCompare,
	loadFindings,
	loadHotspots,
	loadSequences,
	loadUsage,
	type SliceChoice,
	stillReading,
} from "./api";
import { CompareView } from "./CompareView";
import { SECTION_LABEL, type StatsSection } from "./copy";
import { FindingsView } from "./FindingsView";
import { type HotspotsLayout, HotspotsView } from "./HotspotsView";
import { SequencesView } from "./SequencesView";
import { UsageView } from "./UsageView";

const SECTIONS: readonly StatsSection[] = ["findings", "usage", "hotspots", "sequences", "compare"];

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
 * The statistics area of the list panel: findings, usage and cost, and file hotspots over the scope's
 * sessions. Every figure is the server's; the panel polls while the sessions' facts are being read.
 */
export function StatsView({
	host,
	scopeKind,
	attempt,
	actions,
}: {
	host: PanelHost;
	scopeKind: ScopeKind;
	attempt: number;
	actions: StatsActions;
}) {
	const t = useT();
	const [section, setSection] = useState<StatsSection>("findings");
	const [sort, setSort] = useState<HotspotSort>("touches");
	const [layout, setLayout] = useState<HotspotsLayout>("list");
	const [retry, setRetry] = useState(0);
	const [hidden, setHidden] = useState<{ base: string; ids: ReadonlySet<string> } | null>(null);
	const [choice, setChoice] = useState<SliceChoice>({ by: "model", a: null, b: null });
	const scope = listScope(host, scopeKind);
	const base = `${scopeKind}:${host.scope.projectId}:${attempt}:${retry}`;
	const findings = usePolled(
		`findings:${base}`,
		section === "findings",
		(signal) => loadFindings(host, scope, signal),
		stillReading,
	);
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
		section === "compare",
		(signal) => loadCompare(host, scope, choice, signal),
		stillReading,
	);
	const onHide = (id: string, hide: boolean) => {
		const controller = new AbortController();
		hideFinding(host, id, hide, controller.signal).then(
			(ids) => setHidden({ base, ids: new Set(ids) }),
			() => setRetry((current) => current + 1),
		);
	};
	const withHidden = (result: FindingsListResult): FindingsListResult => {
		if (hidden?.base !== base) return result;
		return {
			...result,
			findings: result.findings.map((finding) =>
				finding.hidden === hidden.ids.has(finding.id)
					? finding
					: { ...finding, hidden: hidden.ids.has(finding.id) },
			),
		};
	};
	const again = () => setRetry((current) => current + 1);
	return (
		<div data-testid="stats-view" className="flex min-h-0 flex-1 flex-col">
			<div
				role="toolbar"
				aria-label={t("sessionInsights.stats.sections")}
				className="flex shrink-0 items-center gap-4 border-border-default border-b px-12 py-4"
			>
				{SECTIONS.map((item) => (
					<ToggleSegment
						key={item}
						testid={`stats-section-${item}`}
						label={t(SECTION_LABEL[item])}
						active={section === item}
						onClick={() => setSection(item)}
					/>
				))}
			</div>
			<div className="@container min-h-0 flex-1 overflow-auto">
				{section === "findings" ? (
					<Body polled={findings} onRetry={again}>
						{(value) => (
							<FindingsView
								result={withHidden(value)}
								onShowSessions={actions.onShowSessions}
								onOpenSession={actions.onOpenSession}
								onHide={onHide}
							/>
						)}
					</Body>
				) : section === "usage" ? (
					<Body polled={usage} onRetry={again}>
						{(value) => <UsageView result={value} onShowSessions={actions.onShowSessions} />}
					</Body>
				) : section === "sequences" ? (
					<Body polled={sequences} onRetry={again}>
						{(value) => <SequencesView result={value} actions={actions} />}
					</Body>
				) : section === "compare" ? (
					<Body polled={compare} onRetry={again}>
						{(value, busy) => (
							<CompareView
								result={value}
								busy={busy}
								choice={choice}
								onChoice={setChoice}
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
								onSort={setSort}
								view={layout}
								onView={setLayout}
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
