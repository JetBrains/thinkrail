import type { MessageKey } from "@thinkrail/locales";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	Figure,
	MetricId,
	Rate,
	SessionRef,
	StatsUsageResult,
	TokenTotals,
	UsageModelRow,
	UsageProjectRow,
	UsageRoleRow,
	UsageSkillRow,
	UsageToolRow,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import type { Sources } from "../FigureCell";
import {
	formatCost,
	formatCostExact,
	formatCount,
	formatShare,
	formatSpan,
	formatStart,
	formatTokens,
} from "../format";
import { Fig } from "./Fig";
import { Sparkline } from "./Sparkline";
import { type StatsColumn, StatsTable } from "./StatsTable";
import { seriesFill, swatchOf } from "./UsageChart";

export type UsageTab = "models" | "projects" | "tools" | "commands" | "skills" | "roles";

export const TABS: readonly { id: UsageTab; label: MessageKey }[] = [
	{ id: "models", label: "sessionInsights.usage.tab.models" },
	{ id: "projects", label: "sessionInsights.usage.tab.projects" },
	{ id: "tools", label: "sessionInsights.usage.tab.tools" },
	{ id: "commands", label: "sessionInsights.usage.tab.commands" },
	{ id: "skills", label: "sessionInsights.usage.tab.skills" },
	{ id: "roles", label: "sessionInsights.usage.tab.roles" },
];

export const TABLE_NOTE = {
	models: "sessionInsights.usage.note.models",
	projects: "sessionInsights.usage.note.projects",
	tools: "sessionInsights.usage.note.tools",
	commands: "sessionInsights.usage.note.commands",
	skills: "sessionInsights.usage.note.skills",
	roles: "sessionInsights.usage.note.roles",
} as const satisfies Record<UsageTab, MessageKey>;

export type ShowSessions = (label: string, ids: readonly string[]) => void;

function idsOf(sessions: readonly SessionRef[], indices: readonly number[]): string[] {
	return indices.flatMap((index) => {
		const ref = sessions[index];
		return ref ? [ref.sessionId] : [];
	});
}

export function costText(t: Translator, locale: string, figure: Figure, tokens: number): string {
	if (figure.origin === "notRecorded")
		return t("sessionInsights.usage.costNotRecorded", { tokens: formatTokens(locale, tokens) });
	return formatCost(locale, figure.value ?? 0);
}

function rateText(locale: string, errors: number, rate: Rate | null): string {
	if (!rate || errors === 0) return formatCount(locale, errors);
	return `${formatCount(locale, errors)} · ${formatShare(locale, rate.k, rate.n) ?? ""}`;
}

function rateDetail(t: Translator, locale: string, rate: Rate | null): string | undefined {
	return rate
		? t("sessionInsights.usage.wilson", {
				k: formatCount(locale, rate.k),
				n: formatCount(locale, rate.n),
				low: formatShare(locale, rate.low, 1) ?? "",
				high: formatShare(locale, rate.high, 1) ?? "",
			})
		: undefined;
}

interface Cell {
	text: string;
	origin: Figure["origin"];
	metric: MetricId;
	exact?: string | null;
	detail?: string | undefined;
}

export function FigCell({
	cell,
	sources,
	testId,
}: {
	cell: Cell;
	sources: Sources;
	testId?: string;
}) {
	return (
		<Fig
			text={cell.text}
			origin={cell.origin}
			sources={sources}
			{...(testId ? { testId } : {})}
			figures={[
				{
					metric: cell.metric,
					origin: cell.origin,
					exact: cell.exact ?? cell.text,
					...(cell.detail ? { detail: cell.detail } : {}),
				},
			]}
		/>
	);
}

function NameButton({
	label,
	testId,
	onClick,
	swatch,
	mono,
}: {
	label: string;
	testId: string;
	onClick: () => void;
	swatch?: string;
	mono?: boolean;
}) {
	const t = useT();
	return (
		<Button
			variant="ghost"
			size="s"
			data-testid={testId}
			className="max-w-280"
			tooltip={t("sessionInsights.usage.showSessionsOf", { name: label })}
			onClick={onClick}
		>
			{swatch ? <span aria-hidden className={cn("size-8 shrink-0 rounded-sm", swatch)} /> : null}
			<span className={cn("truncate", mono && "tr-code-text-small")}>{label}</span>
		</Button>
	);
}

function durationCell(t: Translator, locale: string, figure: Figure, metric: MetricId): Cell {
	return {
		text: figure.value === null ? "—" : formatSpan(t, locale, figure.value),
		origin: figure.origin,
		metric,
	};
}

export function tokensCell(locale: string, figure: Figure<TokenTotals>): Cell {
	const value = figure.value;
	return {
		text: formatTokens(locale, value?.total ?? 0),
		origin: figure.origin,
		metric: "tokens",
		exact: formatCount(locale, value?.total ?? 0),
	};
}

function modelColumns(
	t: Translator,
	locale: string,
	result: StatsUsageResult,
	onShow: ShowSessions,
): StatsColumn<UsageModelRow>[] {
	const { sources, sessions } = result;
	const fills = new Map(
		result.usage.byModel.map((series, at) => [series.key, seriesFill(series, at)]),
	);
	return [
		{
			key: "model",
			label: "sessionInsights.usage.column.model",
			sort: (row) => row.model,
			render: (row) => (
				<NameButton
					label={row.model}
					testId="usage-row-name"
					swatch={swatchOf(fills.get(row.model) ?? "fill-series-8")}
					onClick={() => onShow(row.model, idsOf(sessions, row.sessions))}
				/>
			),
		},
		{
			key: "calls",
			label: "sessionInsights.usage.column.calls",
			numeric: true,
			sort: (row) => row.calls.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text: formatCount(locale, row.calls.value ?? 0),
						origin: row.calls.origin,
						metric: "llmCalls",
					}}
				/>
			),
		},
		{
			key: "errors",
			label: "sessionInsights.usage.column.errors",
			numeric: true,
			sort: (row) => (row.errorRate ? row.errorRate.k / row.errorRate.n : null),
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text: rateText(locale, row.errors.value ?? 0, row.errorRate),
						origin: row.errors.origin,
						metric: "errors",
						detail: rateDetail(t, locale, row.errorRate),
					}}
				/>
			),
		},
		{
			key: "tokens",
			label: "sessionInsights.usage.column.tokens",
			numeric: true,
			sort: (row) => row.tokens.value?.total ?? null,
			render: (row) => (
				<FigCell
					sources={sources}
					testId="usage-model-tokens"
					cell={tokensCell(locale, row.tokens)}
				/>
			),
		},
		{
			key: "cost",
			label: "sessionInsights.usage.column.cost",
			numeric: true,
			sort: (row) => row.cost.value,
			render: (row) => (
				<FigCell
					sources={sources}
					testId="usage-model-cost"
					cell={{
						text: costText(t, locale, row.cost, row.tokens.value?.total ?? 0),
						origin: row.cost.origin,
						metric: "cost",
						exact: formatCostExact(locale, row.cost.value ?? 0),
					}}
				/>
			),
		},
		{
			key: "cache",
			label: "sessionInsights.usage.column.cache",
			numeric: true,
			sort: (row) => row.cacheShare.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text:
							row.cacheShare.value === null
								? "—"
								: (formatShare(locale, row.cacheShare.value, 1) ?? ""),
						origin: row.cacheShare.origin,
						metric: "cacheShare",
					}}
				/>
			),
		},
		{
			key: "latency",
			label: "sessionInsights.usage.column.latency",
			numeric: true,
			sort: (row) => row.latencyP50.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						...durationCell(t, locale, row.latencyP50, "modelLatency"),
						detail: t("sessionInsights.usage.measured", {
							measured: formatCount(locale, row.measured),
							total: formatCount(locale, row.calls.value ?? 0),
						}),
					}}
				/>
			),
		},
		{
			key: "window",
			label: "sessionInsights.usage.column.window",
			numeric: true,
			sort: (row) => row.contextWindow.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text:
							row.contextWindow.value === null
								? "—"
								: formatTokens(locale, row.contextWindow.value),
						origin: row.contextWindow.origin,
						metric: "contextWindow",
					}}
				/>
			),
		},
		{
			key: "sessions",
			label: "sessionInsights.usage.column.sessions",
			numeric: true,
			sort: (row) => row.sessions.length,
			render: (row) => formatCount(locale, row.sessions.length),
		},
		{
			key: "days",
			label: "sessionInsights.usage.column.perDay",
			render: (row) => (
				<Sparkline values={row.perDay} fill={fills.get(row.model) ?? "fill-series-8"} />
			),
		},
	];
}

function projectColumns(
	t: Translator,
	locale: string,
	result: StatsUsageResult,
	onShow: ShowSessions,
): StatsColumn<UsageProjectRow>[] {
	const { sources, sessions } = result;
	const name = (row: UsageProjectRow) => row.name ?? t("sessionInsights.group.unregistered");
	return [
		{
			key: "project",
			label: "sessionInsights.usage.column.project",
			sort: name,
			render: (row) => (
				<NameButton
					label={name(row)}
					testId="usage-row-name"
					onClick={() => onShow(name(row), idsOf(sessions, row.sessions))}
				/>
			),
		},
		{
			key: "sessions",
			label: "sessionInsights.usage.column.sessions",
			numeric: true,
			sort: (row) => row.sessions.length,
			render: (row) => formatCount(locale, row.sessions.length),
		},
		{
			key: "tokens",
			label: "sessionInsights.usage.column.tokens",
			numeric: true,
			sort: (row) => row.tokens.value?.total ?? null,
			render: (row) => <FigCell sources={sources} cell={tokensCell(locale, row.tokens)} />,
		},
		{
			key: "cost",
			label: "sessionInsights.usage.column.cost",
			numeric: true,
			sort: (row) => row.cost.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text: costText(t, locale, row.cost, row.tokens.value?.total ?? 0),
						origin: row.cost.origin,
						metric: "cost",
						exact: formatCostExact(locale, row.cost.value ?? 0),
					}}
				/>
			),
		},
		{
			key: "outside",
			label: "sessionInsights.usage.column.outside",
			numeric: true,
			sort: (row) => row.outside.value?.cost ?? null,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text:
							(row.outside.value?.cost ?? 0) > 0
								? `+${formatCost(locale, row.outside.value?.cost ?? 0)}`
								: (row.outside.value?.tokens ?? 0) > 0
									? `+${formatTokens(locale, row.outside.value?.tokens ?? 0)}`
									: "—",
						origin: row.outside.origin,
						metric: "subagentsOutside",
					}}
				/>
			),
		},
		{
			key: "models",
			label: "sessionInsights.usage.column.models",
			render: (row) => (
				<span className="block max-w-240 truncate tr-text-metadata text-text-muted">
					{row.models.join(", ")}
				</span>
			),
		},
		{
			key: "days",
			label: "sessionInsights.usage.column.perDay",
			render: (row) => <Sparkline values={row.perDay} />,
		},
	];
}

function toolColumns(
	t: Translator,
	locale: string,
	result: StatsUsageResult,
	onShow: ShowSessions,
	commands: boolean,
): StatsColumn<UsageToolRow>[] {
	const { sources, sessions } = result;
	return [
		{
			key: "name",
			label: commands
				? "sessionInsights.usage.column.command"
				: "sessionInsights.usage.column.tool",
			sort: (row) => row.name,
			render: (row) => (
				<NameButton
					label={row.name}
					mono
					testId="usage-row-name"
					onClick={() => onShow(row.name, idsOf(sessions, row.sessions))}
				/>
			),
		},
		{
			key: "calls",
			label: "sessionInsights.usage.column.calls",
			numeric: true,
			sort: (row) => row.calls.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text: formatCount(locale, row.calls.value ?? 0),
						origin: row.calls.origin,
						metric: "toolStats",
					}}
				/>
			),
		},
		{
			key: "errors",
			label: "sessionInsights.usage.column.errors",
			numeric: true,
			sort: (row) => row.errors.value,
			render: (row) => (
				<FigCell
					sources={sources}
					testId="usage-tool-errors"
					cell={{
						text: formatCount(locale, row.errors.value ?? 0),
						origin: row.errors.origin,
						metric: "toolStats",
					}}
				/>
			),
		},
		{
			key: "rate",
			label: "sessionInsights.usage.column.errorRate",
			numeric: true,
			sort: (row) => (row.errorRate ? row.errorRate.k / row.errorRate.n : null),
			render: (row) =>
				row.errorRate && row.errorRate.k > 0 ? (
					<FigCell
						sources={sources}
						cell={{
							text: formatShare(locale, row.errorRate.k, row.errorRate.n) ?? "",
							origin: "counted",
							metric: "toolStats",
							detail: rateDetail(t, locale, row.errorRate),
						}}
					/>
				) : (
					<span className="text-text-subtle">—</span>
				),
		},
		{
			key: "sessions",
			label: "sessionInsights.usage.column.sessions",
			numeric: true,
			sort: (row) => row.sessions.length,
			render: (row) => formatCount(locale, row.sessions.length),
		},
		{
			key: "avg",
			label: "sessionInsights.usage.column.average",
			numeric: true,
			sort: (row) => row.durationAvg.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						...durationCell(t, locale, row.durationAvg, "toolDuration"),
						detail: t("sessionInsights.usage.measured", {
							measured: formatCount(locale, row.measured),
							total: formatCount(locale, row.calls.value ?? 0),
						}),
					}}
				/>
			),
		},
		{
			key: "p50",
			label: "sessionInsights.usage.column.median",
			numeric: true,
			sort: (row) => row.durationP50.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={durationCell(t, locale, row.durationP50, "toolDuration")}
				/>
			),
		},
		{
			key: "last",
			label: "sessionInsights.usage.column.last",
			numeric: true,
			sort: (row) => row.last,
			render: (row) => (row.last === null ? "—" : formatStart(locale, row.last, Date.now())),
		},
		{
			key: "days",
			label: "sessionInsights.usage.column.perDay",
			render: (row) => <Sparkline values={row.perDay} fill="fill-series-4" />,
		},
	];
}

function skillColumns(
	t: Translator,
	locale: string,
	result: StatsUsageResult,
	onShow: ShowSessions,
): StatsColumn<UsageSkillRow>[] {
	const { sources, sessions } = result;
	return [
		{
			key: "name",
			label: "sessionInsights.usage.column.skill",
			sort: (row) => row.name,
			render: (row) => (
				<span className="flex min-w-0 items-center gap-4">
					<NameButton
						label={row.name}
						mono
						testId="usage-row-name"
						onClick={() => onShow(row.name, idsOf(sessions, row.sessions))}
					/>
					{row.neverLoaded ? (
						<span
							data-testid="usage-never-loaded"
							className="shrink-0 rounded-full border border-feedback-warning-muted px-4 tr-text-caption text-feedback-warning"
						>
							{t("sessionInsights.usage.neverLoaded")}
						</span>
					) : null}
				</span>
			),
		},
		{
			key: "listed",
			label: "sessionInsights.usage.column.listed",
			numeric: true,
			sort: (row) => row.listedSessions,
			render: (row) =>
				row.listedSessions > 0 ? (
					formatCount(locale, row.listedSessions)
				) : (
					<span className="text-feedback-warning">{t("sessionInsights.usage.notListed")}</span>
				),
		},
		{
			key: "loads",
			label: "sessionInsights.usage.column.loads",
			numeric: true,
			sort: (row) => row.loads.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text: formatCount(locale, row.loads.value ?? 0),
						origin: row.loads.origin,
						metric: "skills",
					}}
				/>
			),
		},
		{
			key: "sessions",
			label: "sessionInsights.usage.column.sessions",
			numeric: true,
			sort: (row) => row.sessions.length,
			render: (row) => formatCount(locale, row.sessions.length),
		},
		{
			key: "description",
			label: "sessionInsights.usage.column.description",
			numeric: true,
			sort: (row) => row.descriptionTokens.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text:
							row.descriptionTokens.value === null
								? "—"
								: formatTokens(locale, row.descriptionTokens.value),
						origin: row.descriptionTokens.origin,
						metric: "skillListing",
					}}
				/>
			),
		},
		{
			key: "last",
			label: "sessionInsights.usage.column.lastLoad",
			numeric: true,
			sort: (row) => row.last,
			render: (row) =>
				row.last === null
					? t("sessionInsights.usage.never")
					: formatStart(locale, row.last, Date.now()),
		},
		{
			key: "days",
			label: "sessionInsights.usage.column.perDay",
			render: (row) => <Sparkline values={row.perDay} fill="fill-series-5" />,
		},
	];
}

function roleColumns(
	t: Translator,
	locale: string,
	result: StatsUsageResult,
	onShow: ShowSessions,
): StatsColumn<UsageRoleRow>[] {
	const { sources, sessions } = result;
	const name = (row: UsageRoleRow) => row.role || t("sessionInsights.usage.noRole");
	return [
		{
			key: "role",
			label: "sessionInsights.usage.column.role",
			sort: name,
			render: (row) => (
				<NameButton
					label={name(row)}
					testId="usage-row-name"
					onClick={() => onShow(name(row), idsOf(sessions, row.sessions))}
				/>
			),
		},
		{
			key: "runs",
			label: "sessionInsights.usage.column.runs",
			numeric: true,
			sort: (row) => row.runs.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text: formatCount(locale, row.runs.value ?? 0),
						origin: row.runs.origin,
						metric: "subagentRoles",
					}}
				/>
			),
		},
		{
			key: "failed",
			label: "sessionInsights.usage.column.failed",
			numeric: true,
			sort: (row) => row.failed.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text: rateText(locale, row.failed.value ?? 0, row.failRate),
						origin: row.failed.origin,
						metric: "subagentRoles",
						detail: rateDetail(t, locale, row.failRate),
					}}
				/>
			),
		},
		{
			key: "tokens",
			label: "sessionInsights.usage.column.tokens",
			numeric: true,
			sort: (row) => row.tokens.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text: row.tokens.value === null ? "—" : formatTokens(locale, row.tokens.value),
						origin: row.tokens.origin,
						metric: "subagentRoles",
					}}
				/>
			),
		},
		{
			key: "cost",
			label: "sessionInsights.usage.column.cost",
			numeric: true,
			sort: (row) => row.cost.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={{
						text: row.cost.value === null ? "—" : formatCost(locale, row.cost.value),
						origin: row.cost.origin,
						metric: "subagentRoles",
					}}
				/>
			),
		},
		{
			key: "p50",
			label: "sessionInsights.usage.column.median",
			numeric: true,
			sort: (row) => row.durationP50.value,
			render: (row) => (
				<FigCell
					sources={sources}
					cell={durationCell(t, locale, row.durationP50, "subagentRoles")}
				/>
			),
		},
		{
			key: "sessions",
			label: "sessionInsights.usage.column.sessions",
			numeric: true,
			sort: (row) => row.sessions.length,
			render: (row) => formatCount(locale, row.sessions.length),
		},
		{
			key: "days",
			label: "sessionInsights.usage.column.perDay",
			render: (row) => <Sparkline values={row.perDay} fill="fill-series-6" />,
		},
	];
}

export function UsageTable({
	tab,
	result,
	onShowSessions,
}: {
	tab: UsageTab;
	result: StatsUsageResult;
	onShowSessions: ShowSessions;
}) {
	const t = useT();
	const locale = localeOf(t);
	const { usage } = result;
	const label = t(
		TABS.find((item) => item.id === tab)?.label ?? "sessionInsights.usage.tab.models",
	);
	switch (tab) {
		case "models":
			return (
				<StatsTable
					testId="usage-table-models"
					rowTestId="usage-row"
					label={label}
					rows={usage.models}
					rowKey={(row) => row.model}
					rowAttributes={(row) => ({ "data-name": row.model })}
					columns={modelColumns(t, locale, result, onShowSessions)}
				/>
			);
		case "projects":
			return (
				<StatsTable
					testId="usage-table-projects"
					rowTestId="usage-row"
					label={label}
					rows={usage.projects}
					rowKey={(row) => row.projectId ?? ""}
					rowAttributes={(row) => ({ "data-name": row.projectId ?? "" })}
					columns={projectColumns(t, locale, result, onShowSessions)}
				/>
			);
		case "tools":
		case "commands":
			return (
				<StatsTable
					testId={`usage-table-${tab}`}
					rowTestId="usage-row"
					label={label}
					rows={tab === "tools" ? usage.tools : usage.commands}
					rowKey={(row) => row.name}
					rowAttributes={(row) => ({ "data-name": row.name })}
					columns={toolColumns(t, locale, result, onShowSessions, tab === "commands")}
				/>
			);
		case "skills":
			return (
				<StatsTable
					testId="usage-table-skills"
					rowTestId="usage-row"
					label={label}
					rows={usage.skills}
					rowKey={(row) => row.name}
					rowAttributes={(row) => ({ "data-name": row.name })}
					columns={skillColumns(t, locale, result, onShowSessions)}
				/>
			);
		case "roles":
			return (
				<StatsTable
					testId="usage-table-roles"
					rowTestId="usage-row"
					label={label}
					rows={usage.roles}
					rowKey={(row) => row.role}
					rowAttributes={(row) => ({ "data-name": row.role })}
					columns={roleColumns(t, locale, result, onShowSessions)}
				/>
			);
	}
}
