import { RiChat3Line, RiPriceTag3Line, RiRobot2Line } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, useT } from "@thinkrail/locales/react";
import type {
	LabelCount,
	SessionLabels,
	SessionOverview,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { isBadged, OUTCOME_LABEL, OUTCOME_TONE, sessionName } from "../copy";
import { chatTargetOf } from "../details/DetailsPanel";
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
import { LabelChips, LabelsButton } from "../labels/LabelsEditor";

function HeaderFigure({
	label,
	figures,
	sources,
	testId,
	children,
}: {
	label: string;
	figures: readonly FigureView[];
	sources: Sources;
	testId: string;
	children: ReactNode;
}) {
	const origin = figures[0]?.origin;
	return (
		<div data-testid={testId} className="flex min-w-0 flex-col">
			<span className="tr-text-caption text-text-subtle">{label}</span>
			<IconTooltip label={<FigureDetails figures={figures} sources={sources} />} align="start">
				<button
					type="button"
					className="flex min-w-0 items-center gap-4 rounded-sm text-left tr-text-ui text-text-default tabular-nums focus-visible:focus-ring"
				>
					<span className="truncate">{children}</span>
					{origin && isBadged(origin) ? <FigureBadge origin={origin} /> : null}
				</button>
			</IconTooltip>
		</div>
	);
}

/** The user's labels and note for the header, with the labels in use for suggestions. */
export interface HeaderLabels {
	entry: SessionLabels | null;
	vocabulary: readonly LabelCount[];
}

export function Header({
	host,
	session,
	sources,
	labels,
	exportMenu,
}: {
	host: PanelHost;
	session: SessionOverview;
	sources: Sources;
	labels: HeaderLabels | null;
	exportMenu: ReactNode;
}) {
	const t = useT();
	const locale = localeOf(t);
	const target = chatTargetOf(session);
	const tokens = session.tokens.value;
	const outside = session.subagentsOutside.value;
	const showOutside = outside !== null && (outside.cost > 0 || outside.tokens > 0);
	const where = [session.projectName, session.workspaceName].filter(Boolean).join(" › ");
	const costFigures: FigureView[] = [
		{
			metric: "cost",
			origin: session.cost.origin,
			exact: session.cost.value === null ? null : formatCostExact(locale, session.cost.value),
		},
	];
	if (showOutside)
		costFigures.push({
			metric: "subagentsOutside",
			origin: session.subagentsOutside.origin,
			exact: formatCostExact(locale, outside.cost),
			detail: t("sessionInsights.cost.tokens", { tokens: formatCount(locale, outside.tokens) }),
		});
	return (
		<header
			data-testid="session-insights-header"
			className="flex shrink-0 flex-col gap-8 border-border-default border-b px-12 py-8"
		>
			<div className="flex min-w-0 items-start gap-8">
				<div className="flex min-w-0 flex-1 flex-col">
					<h1
						data-testid="session-insights-session-title"
						className="truncate tr-title-section text-text-default"
						title={sessionName(t, session)}
					>
						{sessionName(t, session)}
					</h1>
					<span className="flex min-w-0 items-center gap-8 tr-text-metadata text-text-muted">
						<span className="truncate">{where || t("sessionInsights.group.unregistered")}</span>
						{session.live ? (
							<Pill testId="session-insights-live" className="border-primary-muted text-primary">
								{t("sessionInsights.badge.live")}
							</Pill>
						) : null}
						{session.workspaceState === "removed" ? (
							<Pill
								testId="session-insights-removed"
								className="border-border-default text-text-subtle"
							>
								{t("sessionInsights.badge.removed")}
							</Pill>
						) : null}
					</span>
				</div>
				<span className="flex shrink-0 items-center gap-8">
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
					{exportMenu}
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
				</span>
			</div>
			{labels?.entry && (labels.entry.labels.length > 0 || labels.entry.note) ? (
				<div data-testid="session-insights-session-user" className="flex min-w-0 flex-col gap-4">
					<LabelChips labels={labels.entry.labels} all testId="session-insights-session-label" />
					{labels.entry.note ? (
						<p
							data-testid="session-insights-session-note"
							className="line-clamp-3 whitespace-pre-wrap tr-text-metadata text-text-muted"
							title={labels.entry.note}
						>
							{labels.entry.note}
						</p>
					) : null}
				</div>
			) : null}
			<div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-16 gap-y-4">
				<HeaderFigure
					testId="session-insights-session-start"
					label={t("sessionInsights.column.start")}
					sources={sources}
					figures={[
						{
							metric: "start",
							origin: session.start.origin,
							exact:
								session.start.value === null ? null : formatDateTime(locale, session.start.value),
						},
					]}
				>
					{session.start.value === null
						? "—"
						: formatStart(locale, session.start.value, Date.now())}
				</HeaderFigure>
				<HeaderFigure
					testId="session-insights-session-wall"
					label={t("sessionInsights.session.wall")}
					sources={sources}
					figures={[
						{
							metric: "wallTime",
							origin: session.wallMs.origin,
							exact:
								session.wallMs.value === null
									? null
									: formatDuration(t, session.wallMs.value, true),
						},
					]}
				>
					{session.wallMs.value === null ? "—" : formatDuration(t, session.wallMs.value)}
				</HeaderFigure>
				<HeaderFigure
					testId="session-insights-session-active"
					label={t("sessionInsights.column.active")}
					sources={sources}
					figures={[
						{
							metric: "activeTime",
							origin: session.activeMs.origin,
							exact:
								session.activeMs.value === null
									? null
									: formatDuration(t, session.activeMs.value, true),
						},
					]}
				>
					{session.activeMs.value === null ? "—" : formatDuration(t, session.activeMs.value)}
				</HeaderFigure>
				<HeaderFigure
					testId="session-insights-session-tokens"
					label={t("sessionInsights.column.tokens")}
					sources={sources}
					figures={[
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
					]}
				>
					{tokens === null ? "—" : formatTokens(locale, tokens.total)}
				</HeaderFigure>
				<HeaderFigure
					testId="session-insights-session-cost"
					label={t("sessionInsights.column.cost")}
					sources={sources}
					figures={costFigures}
				>
					{session.cost.value === null
						? "—"
						: session.cost.origin === "notRecorded" && tokens !== null
							? t("sessionInsights.session.costNotRecorded", {
									tokens: formatTokens(locale, tokens.total),
								})
							: formatCost(locale, session.cost.value)}
				</HeaderFigure>
				<div className="flex min-w-0 flex-col">
					<span className="tr-text-caption text-text-subtle">
						{t("sessionInsights.column.outcome")}
					</span>
					{session.outcome ? (
						<Pill
							testId="session-insights-session-outcome"
							className={cn("self-start", OUTCOME_TONE[session.outcome])}
						>
							{t(OUTCOME_LABEL[session.outcome])}
						</Pill>
					) : (
						<span className="tr-text-ui text-text-subtle">—</span>
					)}
				</div>
			</div>
			{showOutside ? (
				<span
					data-testid="session-insights-session-outside"
					className="flex items-center gap-4 tr-text-metadata text-text-muted"
				>
					<RiRobot2Line aria-hidden className="size-12 shrink-0" />
					{outside.cost > 0
						? t("sessionInsights.cost.subagentsOutside", { cost: formatCost(locale, outside.cost) })
						: t("sessionInsights.cost.subagentsOutsideTokens", {
								tokens: formatTokens(locale, outside.tokens),
							})}
					{isBadged(session.subagentsOutside.origin) ? (
						<FigureBadge origin={session.subagentsOutside.origin} />
					) : null}
				</span>
			) : null}
			{session.models.length > 0 ? (
				<span
					data-testid="session-insights-session-models"
					className="flex min-w-0 flex-wrap items-center gap-4 tr-text-caption text-text-muted"
				>
					<span className="text-text-subtle">{t("sessionInsights.session.models")}</span>
					{session.models.map((model) => (
						<span
							key={model}
							className="rounded-sm border border-border-default px-4 tr-code-text-small"
						>
							{model}
						</span>
					))}
				</span>
			) : null}
		</header>
	);
}
