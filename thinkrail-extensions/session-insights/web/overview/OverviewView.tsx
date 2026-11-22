import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import type { SessionOverviewResult } from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { type ReactNode, useState } from "react";
import { hostServesThisVersion } from "../load";
import { PENDING, type Pending } from "../session/api";
import { type Query, useKeyedQuery } from "../useKeyedQuery";
import { loadSessionOverview, overviewPending } from "./api";
import { ContextCard, CostCard, ErrorsCard, FilesCard, HappenedCard, SubagentsCard } from "./cards";

/** Where an Overview card leads: a section of the session tab, or the list's Insights → What to do. */
export type OverviewLink =
	| { to: "trace"; mode?: "tree" | "turns" | "timeline"; events?: readonly string[] }
	| { to: "errors"; chain?: number }
	| { to: "cost"; view?: "cost" | "context" }
	| { to: "files"; path?: string }
	| { to: "subagents" }
	| { to: "findings" };

export interface OverviewViewProps {
	host: PanelHost;
	sessionId: string;
	onOpen: (link: OverviewLink) => void;
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

/** The cards in a grid of two columns when the pane is wide, one when it is narrow. */
export function OverviewCards({
	result,
	onOpen,
}: {
	result: SessionOverviewResult;
	onOpen: (link: OverviewLink) => void;
}) {
	const t = useT();
	const cards = result.overview;
	if (!cards) return null;
	const props = { cards, sources: result.sources, onOpen };
	return (
		<section
			data-testid="session-insights-overview"
			data-revision={cards.revision}
			aria-label={t("sessionInsights.overview.region")}
			className="@container min-h-0 flex-1 overflow-y-auto"
		>
			<div className="grid grid-cols-1 gap-12 p-12 @3xl:grid-cols-2">
				<HappenedCard {...props} />
				<CostCard {...props} />
				<ErrorsCard {...props} />
				<ContextCard {...props} />
				<FilesCard {...props} />
				<SubagentsCard {...props} />
			</div>
		</section>
	);
}

/** What the view shows for each state of its query. */
export function OverviewBody({
	query,
	onRetry,
	onOpen,
}: {
	query: Query<SessionOverviewResult | Pending | null>;
	onRetry: () => void;
	onOpen: (link: OverviewLink) => void;
}) {
	const t = useT();
	switch (query.kind) {
		case "loading":
			return (
				<LoadingRegion
					rows={8}
					label={t("sessionInsights.overview.loading")}
					testId="session-insights-overview-loading"
					className="p-16"
				/>
			);
		case "version":
			return (
				<Notice testId="session-insights-update-host">{t("sessionInsights.updateHost")}</Notice>
			);
		case "failed":
			return (
				<Notice testId="session-insights-overview-error">
					<span>{t("sessionInsights.overview.failed")}</span>
					<Button variant="outline" size="m" onClick={onRetry}>
						{t("common.retry")}
					</Button>
				</Notice>
			);
		case "ready":
			if (query.value === PENDING)
				return (
					<LoadingRegion
						rows={8}
						label={t("sessionInsights.overview.loading")}
						testId="session-insights-overview-loading"
						className="p-16"
					/>
				);
			if (query.value === null)
				return (
					<Notice testId="session-insights-overview-missing">
						{t("sessionInsights.session.missing")}
					</Notice>
				);
			return <OverviewCards result={query.value} onOpen={onOpen} />;
	}
}

/**
 * The session tab's landing view: one `session.overview` answer — every card from one trace revision —
 * asked again while the index has not reached the session or the scope's findings are still counted.
 */
export function OverviewView({ host, sessionId, onOpen }: OverviewViewProps) {
	const t = useT();
	const [attempt, setAttempt] = useState(0);
	const serves = hostServesThisVersion(host);
	const query = useKeyedQuery(
		serves ? `${sessionId}:${attempt}` : null,
		(signal) => loadSessionOverview(host, sessionId, signal),
		overviewPending,
	);
	if (!serves)
		return <Notice testId="session-insights-update-host">{t("sessionInsights.updateHost")}</Notice>;
	return (
		<div data-session-id={sessionId} className="flex h-full min-h-0 flex-col">
			<OverviewBody query={query} onRetry={() => setAttempt(attempt + 1)} onOpen={onOpen} />
		</div>
	);
}
