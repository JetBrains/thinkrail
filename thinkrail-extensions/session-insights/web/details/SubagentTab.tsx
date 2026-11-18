import {
	RiArrowGoBackLine,
	RiChatQuoteLine,
	RiErrorWarningLine,
	RiNodeTree,
	RiRobot2Line,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, useT } from "@thinkrail/locales/react";
import type {
	RationaleSource,
	ResultVia,
	SubagentDetail,
	SubagentEvent,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useState } from "react";
import { isBadged } from "../copy";
import { FigureBadge, FigureDetails, type FigureView, type Sources } from "../FigureCell";
import { formatCostExact, formatCount, formatDuration, formatSpan, formatTokens } from "../format";
import { ShareBar } from "../ShareBar";
import { loadSubagent } from "../session/api";
import { drawActivityStrip } from "../subagents/draw";
import { useCanvasLook } from "../trace/look";
import type { TraceModel } from "../trace/model";
import { roleSeries } from "../trace/roles";
import { StripCanvas } from "../trace/StripCanvas";
import { eventTitle, SERIES_TEXT } from "../trace/TraceTree";
import { useKeyedQuery } from "../useKeyedQuery";
import { CappedTextView } from "./CappedTextView";

export const RATIONALE_SOURCE = {
	text: "sessionInsights.subagents.rationale.text",
	thinking: "sessionInsights.subagents.rationale.thinking",
	previous: "sessionInsights.subagents.rationale.previous",
} as const satisfies Record<RationaleSource, MessageKey>;

export const RESULT_VIA = {
	Agent: "sessionInsights.subagents.via.agent",
	get_subagent_result: "sessionInsights.subagents.via.getResult",
	completion: "sessionInsights.subagents.via.completion",
} as const satisfies Record<ResultVia, MessageKey>;

type State =
	| { kind: "loading" }
	| { kind: "ready"; detail: SubagentDetail; sources: Sources }
	| { kind: "missing" }
	| { kind: "failed" };

function useDetail(host: PanelHost, sessionId: string, childId: string): State {
	const query = useKeyedQuery(`${sessionId}\u0000${childId}`, (signal) =>
		loadSubagent(host, sessionId, childId, signal),
	);
	if (query.kind === "loading") return query;
	if (query.kind === "failed") return { kind: "failed" };
	if (query.kind === "version" || !query.value.detail) return { kind: "missing" };
	return { kind: "ready", detail: query.value.detail, sources: query.value.sources };
}

function Section({
	n,
	title,
	testId,
	children,
}: {
	n: number;
	title: string;
	testId: string;
	children: ReactNode;
}) {
	return (
		<section
			data-testid={testId}
			aria-label={title}
			className="flex flex-col gap-6 rounded-md border border-border-default p-8"
		>
			<h3 className="flex items-center gap-6 tr-text-eyebrow text-text-muted">
				<span className="flex size-16 items-center justify-center rounded-full bg-control-bg-selected text-text-default tabular-nums">
					{n}
				</span>
				{title}
			</h3>
			{children}
		</section>
	);
}

function LinkButton({
	testId,
	onClick,
	children,
}: {
	testId: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			data-testid={testId}
			onClick={onClick}
			className="inline-flex min-w-0 items-center gap-4 self-start rounded-sm tr-text-metadata text-primary hover:underline focus-visible:focus-ring"
		>
			{children}
		</button>
	);
}

/** The subagent tab: why it was spawned, how it worked, what came back, and its wave. */
export function SubagentTab({
	host,
	sessionId,
	event,
	model,
	onSelect,
	onShowChild,
}: {
	host: PanelHost;
	sessionId: string;
	event: SubagentEvent;
	model: TraceModel;
	onSelect: (index: number) => void;
	onShowChild?: ((childId: string, eventId: string | null) => void) | undefined;
}) {
	const t = useT();
	const locale = localeOf(t);
	const state = useDetail(host, sessionId, event.childId);
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const { palette } = useCanvasLook(root);
	if (state.kind === "loading")
		return <LoadingRegion rows={4} label={t("sessionInsights.details.loading")} className="py-4" />;
	if (state.kind !== "ready") return <BasicFacts event={event} failed={state.kind === "failed"} />;
	const { detail, sources } = state;
	const { run } = detail;
	const goTo = (id: string | null) => {
		const at = id ? model.indexOf(id) : -1;
		if (at >= 0) onSelect(at);
	};
	const reader = run.consumedBy ? model.at(model.indexOf(run.consumedBy)) : undefined;
	const failed = run.status === "failed" || run.status === "error" || run.status === "aborted";
	const figures: FigureView[] = [
		{
			metric: "subagentRun",
			origin: run.duration.origin,
			exact: run.duration.value === null ? null : formatDuration(t, run.duration.value, true),
		},
		{
			metric: "tokens",
			origin: run.tokens.origin,
			exact: run.tokens.value === null ? null : formatCount(locale, run.tokens.value),
		},
		{
			metric: "cost",
			origin: run.cost.origin,
			exact: run.cost.value === null ? null : formatCostExact(locale, run.cost.value),
		},
	];
	const badge = figures.find((figure) => isBadged(figure.origin))?.origin;
	return (
		<div ref={setRoot} data-testid="subagent-tab" className="flex flex-col gap-8">
			<div className="flex flex-wrap items-center gap-4 tr-text-caption">
				<span
					className={cn(
						"inline-flex items-center gap-2 rounded-full border border-border-default px-6",
						SERIES_TEXT[roleSeries(run.role)],
					)}
				>
					<RiRobot2Line aria-hidden className="size-12" />
					{run.role ?? t("sessionInsights.trace.subagent")}
				</span>
				<span
					className={cn(
						"rounded-full border px-6",
						failed
							? "border-feedback-error-muted text-feedback-error"
							: "border-border-default text-text-muted",
					)}
				>
					{run.status ?? "—"}
				</span>
				<span className="rounded-full border border-border-default px-6 text-text-muted">
					{t(
						run.background
							? "sessionInsights.subagents.background"
							: "sessionInsights.subagents.foreground",
					)}
				</span>
				{run.model ? (
					<span className="rounded-full border border-border-default px-6 tr-code-text-small text-text-muted">
						{run.model}
					</span>
				) : null}
				<IconTooltip label={<FigureDetails figures={figures} sources={sources} />} align="start">
					<button
						type="button"
						data-testid="subagent-figures"
						className="inline-flex items-center gap-4 rounded-sm text-text-muted tabular-nums focus-visible:focus-ring"
					>
						{run.duration.value === null ? "—" : formatSpan(t, locale, run.duration.value)}
						{" · "}
						{run.cost.value !== null && run.cost.value > 0
							? `${formatCostExact(locale, run.cost.value)} · `
							: ""}
						{t("sessionInsights.turns.tokens", {
							tokens: run.tokens.value === null ? "—" : formatTokens(locale, run.tokens.value),
						})}
						{badge && isBadged(badge) ? <FigureBadge origin={badge} /> : null}
					</button>
				</IconTooltip>
			</div>

			<Section n={1} title={t("sessionInsights.subagents.why")} testId="subagent-why">
				<p className="tr-text-ui text-text-default">{run.title || "—"}</p>
				{detail.rationale && run.rationale ? (
					<figure className="flex flex-col gap-4 border-primary-muted border-l-2 pl-8">
						<figcaption className="flex flex-wrap items-center gap-4 tr-text-caption text-text-subtle">
							<RiChatQuoteLine aria-hidden className="size-12" />
							{t(RATIONALE_SOURCE[run.rationale.source])}
						</figcaption>
						<CappedTextView
							value={detail.rationale}
							label={t("sessionInsights.subagents.rationaleTitle")}
							query=""
							prose
							testId="subagent-rationale"
						/>
						<LinkButton
							testId="subagent-rationale-link"
							onClick={() => goTo(run.rationale?.eventId ?? null)}
						>
							{t("sessionInsights.subagents.toParentCall")}
						</LinkButton>
					</figure>
				) : (
					<p className="tr-text-metadata text-text-subtle">
						{t("sessionInsights.subagents.noRationale")}
					</p>
				)}
				{detail.task ? (
					<CappedTextView
						value={detail.task}
						label={t("sessionInsights.details.task")}
						query=""
						prose
						testId="subagent-task"
					/>
				) : null}
				<LinkButton testId="subagent-spawn-link" onClick={() => goTo(run.spawnEventId)}>
					{t("sessionInsights.subagents.toSpawn")}
				</LinkButton>
			</Section>

			<Section n={2} title={t("sessionInsights.subagents.how")} testId="subagent-how">
				{run.activity ? (
					<>
						<StripCanvas
							className="h-40 w-full"
							testId="subagent-activity"
							draw={
								palette && run.activity
									? (context, width, height) =>
											run.activity &&
											drawActivityStrip(context, width, height, run.activity, palette)
									: null
							}
						/>
						<p className="tr-text-metadata text-text-muted tabular-nums">
							{t("sessionInsights.subagents.counts", {
								llm: formatCount(locale, run.activity.llmCalls),
								tools: formatCount(locale, run.activity.toolCalls),
								errors: formatCount(locale, run.activity.errors),
							})}
						</p>
					</>
				) : (
					<p data-testid="subagent-no-data" className="tr-text-metadata text-text-subtle">
						{t(
							run.transcript === "removed"
								? "sessionInsights.subagents.removed"
								: "sessionInsights.subagents.noTranscript",
						)}
					</p>
				)}
				{detail.tools.length > 0 ? (
					<ul className="flex flex-col gap-2" aria-label={t("sessionInsights.subagents.tools")}>
						{detail.tools.slice(0, 10).map((tool) => (
							<li key={tool.tool} className="flex items-center gap-8 tr-text-metadata">
								<span className="w-120 shrink-0 truncate tr-code-text-small text-text-default">
									{tool.tool}
								</span>
								<ShareBar
									total={detail.tools[0]?.calls ?? 1}
									parts={[
										{ key: "ok", value: tool.calls - tool.errors, fill: "fill-series-4" },
										{ key: "failed", value: tool.errors, fill: "fill-feedback-error" },
									]}
								/>
								<span className="w-64 shrink-0 text-right text-text-muted tabular-nums">
									{formatCount(locale, tool.calls)}
									{tool.errors > 0 ? (
										<span className="text-feedback-error">
											{" "}
											· {formatCount(locale, tool.errors)}
										</span>
									) : null}
								</span>
							</li>
						))}
					</ul>
				) : null}
				{detail.failures.length > 0 ? (
					<ul className="flex flex-col gap-2" aria-label={t("sessionInsights.subagents.failures")}>
						{detail.failures.map((failure) => (
							<li key={failure.eventId}>
								<button
									type="button"
									data-testid="subagent-failure"
									disabled={!onShowChild}
									onClick={() => onShowChild?.(run.childId, failure.eventId)}
									className="flex w-full min-w-0 items-center gap-4 rounded-sm border border-feedback-error-muted px-6 py-2 text-left tr-text-metadata hover:bg-control-bg-hovered focus-visible:focus-ring"
								>
									<RiErrorWarningLine
										aria-hidden
										className="size-12 shrink-0 text-feedback-error"
									/>
									<span className="shrink-0 tr-code-text-small text-text-default">
										{failure.tool ?? t("sessionInsights.trace.llm")}
									</span>
									<span className="min-w-0 truncate text-text-muted">{failure.line}</span>
								</button>
							</li>
						))}
					</ul>
				) : null}
				{detail.skills.length > 0 ? (
					<p className="tr-text-metadata text-text-muted">
						{t("sessionInsights.subagents.skills", { skills: detail.skills.join(", ") })}
					</p>
				) : null}
				{run.transcript === "available" && onShowChild ? (
					<Button
						variant="outline"
						size="s"
						iconLeft={RiNodeTree}
						className="self-start"
						data-testid="subagent-expand"
						onClick={() => onShowChild(run.childId, null)}
					>
						{t("sessionInsights.subagents.expand")}
					</Button>
				) : null}
			</Section>

			<Section n={3} title={t("sessionInsights.subagents.what")} testId="subagent-what">
				{run.result && detail.result ? (
					<>
						<p className="flex flex-wrap items-center gap-4 tr-text-caption text-text-muted">
							<span>{t(RESULT_VIA[run.result.via])}</span>
							{run.result.status ? <span>· {run.result.status}</span> : null}
							<span className="tabular-nums">
								·{" "}
								{t("sessionInsights.subagents.chars", { n: formatCount(locale, run.result.chars) })}
							</span>
						</p>
						<LinkButton
							testId="subagent-result-link"
							onClick={() => goTo(run.result?.eventId ?? null)}
						>
							{t("sessionInsights.subagents.toResult")}
						</LinkButton>
						{reader ? (
							<LinkButton testId="subagent-consumed" onClick={() => goTo(reader.id)}>
								<RiArrowGoBackLine aria-hidden className="size-12" />
								{t("sessionInsights.subagents.consumed", { call: eventTitle(t, reader) })}
							</LinkButton>
						) : null}
						<CappedTextView
							value={detail.result}
							label={t("sessionInsights.subagents.result")}
							query=""
							prose
							testId="subagent-result"
						/>
					</>
				) : (
					<p className="tr-text-metadata text-text-subtle">
						{t("sessionInsights.subagents.noResult")}
					</p>
				)}
			</Section>

			{detail.siblings.length > 1 ? (
				<section
					aria-label={t("sessionInsights.subagents.siblings")}
					data-testid="subagent-siblings"
					className="flex flex-col gap-4"
				>
					<span className="tr-text-eyebrow text-text-muted">
						{t("sessionInsights.subagents.siblingsCount", {
							n: formatCount(locale, detail.siblings.length),
						})}
					</span>
					<ul className="flex flex-col gap-2">
						{detail.siblings.map((sibling) => {
							const at = model.indexOf(`sub:${sibling.childId}`);
							const current = sibling.childId === run.childId;
							return (
								<li key={sibling.childId}>
									<button
										type="button"
										data-testid="subagent-sibling"
										aria-current={current ? "true" : undefined}
										disabled={at < 0}
										onClick={() => onSelect(at)}
										className={cn(
											"flex w-full min-w-0 items-center gap-4 rounded-sm border px-6 py-2 text-left tr-text-metadata hover:bg-control-bg-hovered focus-visible:focus-ring",
											current
												? "border-primary-muted bg-control-bg-selected"
												: "border-border-default",
										)}
									>
										<RiRobot2Line
											aria-hidden
											className={cn("size-12 shrink-0", SERIES_TEXT[roleSeries(sibling.role)])}
										/>
										<span className="shrink-0 text-text-default">{sibling.role ?? "—"}</span>
										<span className="min-w-0 truncate text-text-muted">{sibling.title}</span>
										<span className="ml-auto shrink-0 text-text-subtle tabular-nums">
											{formatSpan(t, locale, Math.max(0, sibling.t1 - sibling.t0))}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			) : null}
		</div>
	);
}

function BasicFacts({ event, failed }: { event: SubagentEvent; failed: boolean }) {
	const t = useT();
	const locale = localeOf(t);
	return (
		<div className="flex flex-col gap-8">
			{failed ? (
				<p role="alert" className="tr-text-metadata text-text-muted">
					{t("sessionInsights.details.failed")}
				</p>
			) : null}
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-12 gap-y-2 tr-text-metadata">
				<dt className="text-text-subtle">{t("sessionInsights.details.role")}</dt>
				<dd className="min-w-0 truncate text-text-default">{event.role ?? "—"}</dd>
				<dt className="text-text-subtle">{t("sessionInsights.details.status")}</dt>
				<dd className="min-w-0 truncate text-text-default">{event.status ?? "—"}</dd>
				<dt className="text-text-subtle">{t("sessionInsights.details.tokens")}</dt>
				<dd className="min-w-0 truncate text-text-default tabular-nums">
					{event.tokens === null ? "—" : formatTokens(locale, event.tokens)}
				</dd>
				<dt className="text-text-subtle">{t("sessionInsights.details.child")}</dt>
				<dd className="min-w-0 truncate">
					<code className="tr-code-text-small">{event.childId}</code>
				</dd>
			</dl>
		</div>
	);
}
