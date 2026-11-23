import {
	RiArrowRightLine,
	RiCheckboxCircleLine,
	RiCloseCircleLine,
	RiErrorWarningLine,
	RiFocus3Line,
	RiIndeterminateCircleLine,
	RiRepeatLine,
	RiRouteLine,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	ChainOutcome,
	DiffSegment,
	ErrorDetail,
	RecoveryChain,
	SessionAnalysis,
	TraceEvent,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { CappedTextView } from "../details/CappedTextView";
import { FigureDetails, type Sources } from "../FigureCell";
import { formatClock, formatCount, formatDateTime, formatShare, formatSpan } from "../format";
import { ShareBar } from "../ShareBar";
import { loadErrorDetail } from "../session/api";
import type { TraceModel } from "../trace/model";
import type { TraceFocus } from "../trace/TraceExplorer";
import { eventIcon, eventTitle, eventTone } from "../trace/TraceTree";
import { useKeyedQuery } from "../useKeyedQuery";

const OUTCOME_LABEL = {
	recovered: "sessionInsights.errors.outcome.recovered",
	gaveUp: "sessionInsights.errors.outcome.gaveUp",
	changedApproach: "sessionInsights.errors.outcome.changedApproach",
	unfinished: "sessionInsights.errors.outcome.unfinished",
	sameModel: "sessionInsights.errors.outcome.sameModel",
	afterSwitch: "sessionInsights.errors.outcome.afterSwitch",
	never: "sessionInsights.errors.outcome.never",
} as const satisfies Record<ChainOutcome, MessageKey>;

const RECOVERED: ReadonlySet<ChainOutcome> = new Set(["recovered", "sameModel", "afterSwitch"]);

/** A chain's tone: recovered, unfinished (its last retry never ran: neither recovered nor failed), or not recovered. */
function outcomeTone(outcome: ChainOutcome): { border: string; text: string } {
	if (RECOVERED.has(outcome))
		return { border: "border-l-feedback-success", text: "text-feedback-success" };
	if (outcome === "unfinished")
		return { border: "border-l-border-default", text: "text-text-muted" };
	return { border: "border-l-feedback-error", text: "text-feedback-error" };
}

/** A tool call without a recorded result: it never ran. */
function notRun(event: TraceEvent | undefined): boolean {
	return event?.kind === "tool" && event.missing === true;
}

type DetailState =
	| { kind: "loading" }
	| { kind: "ready"; detail: ErrorDetail }
	| { kind: "missing" }
	| { kind: "failed" };

function useErrorDetail(host: PanelHost, sessionId: string, chain: number | null): DetailState {
	const query = useKeyedQuery(chain === null ? null : `${sessionId}\u0000${chain}`, (signal) =>
		loadErrorDetail(host, sessionId, chain ?? 0, signal),
	);
	if (query.kind === "loading") return query;
	if (query.kind !== "ready") return { kind: "failed" };
	return query.value.detail ? { kind: "ready", detail: query.value.detail } : { kind: "missing" };
}

function chainTitle(t: Translator, chain: RecoveryChain): string {
	return chain.kind === "model"
		? t("sessionInsights.errors.modelChain", {
				n: chain.attempts.length - (RECOVERED.has(chain.outcome) ? 1 : 0),
			})
		: t("sessionInsights.errors.toolChain", {
				tool: chain.name ?? "",
				count: chain.attempts.length,
				n: chain.attempts.length,
			});
}

function outcomeText(t: Translator, locale: string, chain: RecoveryChain): string {
	const base = t(OUTCOME_LABEL[chain.outcome]);
	if (chain.recoveredIn.value === null) return base;
	return t("sessionInsights.errors.recoveredIn", {
		outcome: base,
		duration: formatSpan(t, locale, chain.recoveredIn.value),
	});
}

/** Diff segments keyed by where they start in the joined text: stable without an index key. */
function keyedSegments(diff: readonly DiffSegment[]): (DiffSegment & { key: string })[] {
	const out: (DiffSegment & { key: string })[] = [];
	let offset = 0;
	for (const segment of diff) {
		out.push({ ...segment, key: `${segment.op}:${offset}` });
		offset += segment.text.length;
	}
	return out;
}

export function chainFocus(t: Translator, chain: RecoveryChain): TraceFocus {
	return {
		ids: [...chain.attempts, ...chain.between.flat()],
		label: t("sessionInsights.errors.focusLabel", {
			n: chain.index + 1,
			title: chainTitle(t, chain),
		}),
	};
}

function OutcomeIcon({ outcome }: { outcome: ChainOutcome }) {
	if (RECOVERED.has(outcome))
		return <RiCheckboxCircleLine aria-hidden className="size-14 shrink-0 text-feedback-success" />;
	if (outcome === "changedApproach")
		return <RiRouteLine aria-hidden className="size-14 shrink-0 text-text-muted" />;
	if (outcome === "unfinished")
		return <RiIndeterminateCircleLine aria-hidden className="size-14 shrink-0 text-text-muted" />;
	return <RiCloseCircleLine aria-hidden className="size-14 shrink-0 text-feedback-error" />;
}

function AttemptChip({ model, id, n }: { model: TraceModel; id: string; n: number }) {
	const t = useT();
	const event = model.at(model.indexOf(id));
	if (!event) return null;
	const Icon = eventIcon(event);
	const missing = notRun(event);
	return (
		<span
			data-testid="errors-attempt-chip"
			data-missing={missing ? "true" : undefined}
			className={cn(
				"inline-flex min-w-0 max-w-240 items-center gap-4 rounded-sm border px-6 py-2 tr-text-caption",
				missing
					? "border-border-default border-dashed text-text-muted"
					: event.error
						? "border-feedback-error-muted text-feedback-error"
						: "border-feedback-success-muted text-feedback-success",
			)}
		>
			<Icon aria-hidden className={cn("size-12 shrink-0", eventTone(event))} />
			<span className="shrink-0 tabular-nums">#{n}</span>
			<span className="min-w-0 truncate tr-code-text-small text-text-default">
				{event.kind === "tool" ? (event.head ?? event.tool) : eventTitle(t, event)}
			</span>
			{missing ? (
				<span>{t("sessionInsights.trace.noResult")}</span>
			) : (
				<span aria-hidden>{event.error ? "✕" : "✓"}</span>
			)}
		</span>
	);
}

function ChainCard({
	chain,
	model,
	active,
	onOpen,
}: {
	chain: RecoveryChain;
	model: TraceModel;
	active: boolean;
	onOpen: () => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const tone = outcomeTone(chain.outcome);
	return (
		<li>
			<button
				type="button"
				data-testid="errors-chain"
				data-chain={chain.index}
				data-outcome={chain.outcome}
				aria-pressed={active}
				onClick={onOpen}
				className={cn(
					"flex w-full min-w-0 flex-col gap-4 rounded-md border border-l-2 px-8 py-6 text-left focus-visible:focus-ring",
					tone.border,
					active
						? "border-primary-muted bg-control-bg-selected"
						: "border-border-default hover:bg-control-bg-hovered",
				)}
			>
				<span className="flex min-w-0 items-center gap-6 tr-text-metadata">
					<OutcomeIcon outcome={chain.outcome} />
					<span className="shrink-0 text-text-default">{chainTitle(t, chain)}</span>
					<span className="min-w-0 flex-1 truncate tr-code-text-small text-text-muted">
						{chain.line}
					</span>
					<span className={cn("shrink-0 tr-text-caption", tone.text)}>
						{outcomeText(t, locale, chain)}
					</span>
				</span>
				<span className="flex min-w-0 flex-wrap items-center gap-4">
					{chain.attempts.map((id, at) => (
						<span key={id} className="inline-flex min-w-0 items-center gap-4">
							{at > 0 ? (
								<span className="inline-flex items-center gap-2 tr-text-caption text-text-subtle">
									{(chain.between[at - 1]?.length ?? 0) > 0 ? (
										<span className="rounded-sm border border-border-default border-dashed px-4">
											{t("sessionInsights.errors.between", {
												count: chain.between[at - 1]?.length ?? 0,
												n: formatCount(locale, chain.between[at - 1]?.length ?? 0),
											})}
										</span>
									) : null}
									<RiArrowRightLine aria-hidden className="size-12" />
								</span>
							) : null}
							<AttemptChip model={model} id={id} n={at + 1} />
						</span>
					))}
					{chain.kind === "model" && chain.prompts > 0 ? (
						<span className="tr-text-caption text-text-subtle">
							{t("sessionInsights.errors.prompts", {
								count: chain.prompts,
								n: formatCount(locale, chain.prompts),
							})}
						</span>
					) : null}
				</span>
			</button>
		</li>
	);
}

function ChainDetail({
	host,
	sessionId,
	chain,
	model,
	onShowInTrace,
}: {
	host: PanelHost;
	sessionId: string;
	chain: RecoveryChain;
	model: TraceModel;
	onShowInTrace: (focus: TraceFocus, first: string) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const state = useErrorDetail(host, sessionId, chain.index);
	const showCluster = (ids: readonly string[], label: string) =>
		onShowInTrace({ ids, label }, ids[0] ?? chain.attempts[0] ?? "");
	return (
		<div
			data-testid="errors-detail"
			data-chain={chain.index}
			className="flex h-full min-h-0 flex-col"
		>
			<header className="flex flex-col gap-4 border-border-default border-b px-12 py-8">
				<div className="flex min-w-0 items-center gap-8">
					<OutcomeIcon outcome={chain.outcome} />
					<h3 className="min-w-0 truncate tr-title-compact text-text-default">
						{chainTitle(t, chain)}
					</h3>
				</div>
				<p className="tr-text-metadata text-text-muted">
					{outcomeText(t, locale, chain)} · {formatDateTime(locale, chain.t0)}
				</p>
				<Button
					variant="soft-primary"
					size="s"
					iconLeft={RiFocus3Line}
					className="self-start"
					data-testid="errors-show-in-trace"
					onClick={() => onShowInTrace(chainFocus(t, chain), chain.attempts[0] ?? "")}
				>
					{t("sessionInsights.errors.showInTrace")}
				</Button>
			</header>
			<div className="min-h-0 flex-1 overflow-auto px-12 py-8">
				{state.kind === "loading" ? (
					<LoadingRegion rows={4} label={t("sessionInsights.details.loading")} className="py-4" />
				) : state.kind !== "ready" ? (
					<p role="alert" className="tr-text-metadata text-text-muted">
						{t(
							state.kind === "missing"
								? "sessionInsights.details.gone"
								: "sessionInsights.details.failed",
						)}
					</p>
				) : (
					<div className="flex flex-col gap-12">
						{state.detail.cluster ? (
							<section
								data-testid="errors-cluster"
								aria-label={t("sessionInsights.errors.cluster")}
								className="flex flex-col gap-4"
							>
								<span className="tr-text-eyebrow text-text-muted">
									{t("sessionInsights.errors.cluster")}
								</span>
								<code className="rounded-sm border border-border-default bg-container-elevated-bg px-6 py-4 tr-code-text-small text-text-default">
									{state.detail.cluster.key}
								</code>
								<span className="tr-text-caption text-text-subtle">
									{t("sessionInsights.errors.clusterCount", {
										count: state.detail.cluster.ids.length,
										n: formatCount(locale, state.detail.cluster.ids.length),
									})}{" "}
									· {t("sessionInsights.errors.clusterHeuristic")}
								</span>
								{state.detail.cluster.ids.length > 1 ? (
									<Button
										variant="ghost"
										size="s"
										iconLeft={RiFocus3Line}
										className="self-start"
										data-testid="errors-cluster-trace"
										onClick={() =>
											state.kind === "ready" &&
											state.detail.cluster &&
											showCluster(
												state.detail.cluster.ids,
												t("sessionInsights.errors.clusterFocus", { key: state.detail.cluster.key }),
											)
										}
									>
										{t("sessionInsights.errors.clusterInTrace")}
									</Button>
								) : null}
							</section>
						) : null}
						<ol className="flex flex-col gap-8" aria-label={t("sessionInsights.errors.attempts")}>
							{state.detail.attempts.map((attempt, at) => {
								const event = model.at(model.indexOf(attempt.eventId));
								return (
									<li
										key={attempt.eventId}
										data-testid="errors-attempt"
										className="flex flex-col gap-6"
									>
										{at > 0 && attempt.between.length > 0 ? (
											<div
												data-testid="errors-between"
												className="flex flex-col gap-2 rounded-sm border border-border-default border-dashed px-8 py-4"
											>
												<span className="tr-text-eyebrow text-text-muted">
													{t("sessionInsights.errors.betweenTitle")}
												</span>
												{attempt.between.map((step) => (
													<span
														key={step.eventId}
														className={cn(
															"flex min-w-0 items-center gap-4 tr-text-metadata",
															step.edit ? "text-text-default" : "text-text-muted",
														)}
													>
														<span className="shrink-0 tr-code-text-small">{step.tool}</span>
														<span className="min-w-0 truncate tr-code-text-small">
															{step.label}
														</span>
														{step.failed ? (
															<span className="shrink-0 text-feedback-error">
																{t("sessionInsights.trace.failed")}
															</span>
														) : step.missing ? (
															<span className="shrink-0 text-text-muted">
																{t("sessionInsights.trace.noResult")}
															</span>
														) : null}
													</span>
												))}
											</div>
										) : null}
										{at > 0 && attempt.diff ? (
											<div
												data-testid="errors-diff"
												className="flex flex-col gap-2 rounded-sm border border-border-default px-8 py-4"
											>
												<span className="tr-text-eyebrow text-text-muted">
													{t("sessionInsights.errors.diffTitle", { n: at })}
												</span>
												<p className="whitespace-pre-wrap break-all tr-code-text-small text-text-muted">
													{keyedSegments(attempt.diff).map((segment) => (
														<span
															key={segment.key}
															data-op={segment.op}
															className={cn(
																segment.op === "added" &&
																	"rounded-sm bg-feedback-success-subtle text-feedback-success",
																segment.op === "removed" &&
																	"rounded-sm bg-feedback-error-subtle text-feedback-error line-through",
															)}
														>
															{segment.text}
														</span>
													))}
												</p>
											</div>
										) : null}
										<div
											className={cn(
												"flex flex-col gap-4 rounded-md border px-8 py-6",
												attempt.missing
													? "border-border-default border-dashed"
													: attempt.failed
														? "border-feedback-error-muted"
														: "border-feedback-success-muted",
											)}
										>
											<span className="flex min-w-0 flex-wrap items-center gap-6 tr-text-metadata">
												<span className="tabular-nums text-text-default">#{at + 1}</span>
												<span
													data-testid="errors-attempt-outcome"
													className={cn(
														"rounded-sm px-4 tr-text-caption",
														attempt.missing
															? "bg-container-header-bg text-text-muted"
															: attempt.failed
																? "bg-feedback-error-subtle text-feedback-error"
																: "bg-feedback-success-subtle text-feedback-success",
													)}
												>
													{t(
														attempt.missing
															? "sessionInsights.trace.noResult"
															: attempt.failed
																? "sessionInsights.errors.failed"
																: "sessionInsights.errors.succeeded",
													)}
												</span>
												<span className="text-text-subtle tabular-nums">
													{formatClock(locale, attempt.t0, true)}
													{attempt.t1 > attempt.t0
														? ` · ${formatSpan(t, locale, attempt.t1 - attempt.t0)}`
														: ""}
													{attempt.exit && attempt.exit !== "0"
														? ` · ${t("sessionInsights.trace.exit", { code: attempt.exit })}`
														: ""}
												</span>
												{attempt.model ? (
													<span className="tr-code-text-small text-text-muted">
														{attempt.model}
													</span>
												) : null}
												{event ? (
													<span className="ml-auto shrink-0 tr-text-caption text-text-subtle">
														{eventTitle(t, event)}
													</span>
												) : null}
											</span>
											{attempt.argument ? (
												<CappedTextView
													value={attempt.argument}
													label={t("sessionInsights.errors.argument")}
													query=""
													testId="errors-argument"
												/>
											) : null}
											{attempt.error ? (
												<CappedTextView
													value={attempt.error}
													label={t("sessionInsights.details.error")}
													query=""
													tone="error"
													testId="errors-error"
												/>
											) : null}
										</div>
									</li>
								);
							})}
						</ol>
					</div>
				)}
			</div>
		</div>
	);
}

/** The errors section: recovery rates per tool and after model errors, recovery chains and repeats. */
export function ErrorsView({
	host,
	sessionId,
	model,
	analysis,
	sources,
	onShowInTrace,
	chain: chosen,
	onChain,
}: {
	host: PanelHost;
	sessionId: string;
	model: TraceModel;
	analysis: SessionAnalysis | null;
	sources: Sources;
	onShowInTrace: (focus: TraceFocus, first: string) => void;
	/** The chain whose detail shows (its `index`); `null`: the first retried one. */
	chain: number | null;
	onChain: (index: number) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const chains = analysis?.chains ?? [];
	const retried = chains.filter((chain) => chain.kind === "model" || chain.attempts.length > 1);
	const single = chains.filter((chain) => chain.kind === "tool" && chain.attempts.length === 1);
	const [showSingle, setShowSingle] = useState(() =>
		single.some((chain) => chain.index === chosen),
	);
	const stacked = host.placement === "chatPane";
	const current = chains.find((chain) => chain.index === chosen) ?? retried[0] ?? chains[0] ?? null;
	if (!analysis || (chains.length === 0 && analysis.repeats.length === 0))
		return (
			<div
				data-testid="errors-empty"
				className="flex h-full items-center justify-center p-16 tr-text-ui text-text-muted"
			>
				{t("sessionInsights.errors.none")}
			</div>
		);
	const recoveredChains = retried.filter((chain) => RECOVERED.has(chain.outcome)).length;
	const models = analysis.modelRecovery;
	const how = (
		<FigureDetails
			figures={[{ metric: "recovery", origin: "approximated", exact: null }]}
			sources={sources}
		/>
	);
	return (
		<ResizablePanelGroup direction={stacked ? "vertical" : "horizontal"} className="h-full min-h-0">
			<ResizablePanel defaultSize={58} minSize={35}>
				<div data-testid="errors-view" className="h-full min-h-0 overflow-auto">
					<div className="flex min-w-0 flex-col gap-12 p-12">
						<div className="flex flex-wrap items-baseline gap-8">
							<h2 className="tr-title-compact text-text-default">
								{t("sessionInsights.errors.title")}
							</h2>
							<span className="tr-text-metadata text-text-muted">
								{t("sessionInsights.errors.question")}
							</span>
						</div>
						<div
							data-testid="errors-chips"
							className="flex flex-wrap items-center gap-4 tr-text-caption"
						>
							<span className="rounded-full border border-feedback-error-muted px-6 text-feedback-error">
								{t("sessionInsights.errors.toolErrors", {
									n: formatCount(locale, analysis.toolFailures),
								})}
							</span>
							<span className="rounded-full border border-border-default px-6 text-text-muted">
								{t("sessionInsights.errors.modelErrors", {
									n: formatCount(locale, models.failures),
								})}
							</span>
							<span className="rounded-full border border-border-default px-6 text-text-muted">
								{t("sessionInsights.errors.clusters", {
									n: formatCount(locale, analysis.clusters.length),
								})}
							</span>
							<span className="rounded-full border border-feedback-warning-muted px-6 text-feedback-warning">
								{t("sessionInsights.errors.retries", {
									n: formatCount(locale, retried.filter((chain) => chain.kind === "tool").length),
									ok: formatCount(locale, recoveredChains),
								})}
							</span>
							<span className="rounded-full border border-feedback-warning-muted px-6 text-feedback-warning">
								{t("sessionInsights.errors.repeats", {
									n: formatCount(locale, analysis.repeats.length),
								})}
							</span>
						</div>

						<section
							data-testid="errors-recovery"
							aria-label={t("sessionInsights.errors.recoveryTitle")}
							className="flex flex-col rounded-md border border-border-default"
						>
							<div className="flex flex-wrap items-center gap-8 border-border-default border-b px-8 py-4 tr-text-caption text-text-muted">
								<span className="tr-text-eyebrow">{t("sessionInsights.errors.recoveryTitle")}</span>
								<span className="inline-flex items-center gap-4">
									<span className="size-8 rounded-sm bg-feedback-success" />
									{t("sessionInsights.errors.legend.recovered")}
								</span>
								<span className="inline-flex items-center gap-4">
									<span className="size-8 rounded-sm bg-series-8" />
									{t("sessionInsights.errors.legend.changed")}
								</span>
								<span className="inline-flex items-center gap-4">
									<span className="size-8 rounded-sm bg-feedback-error" />
									{t("sessionInsights.errors.legend.gaveUp")}
								</span>
								{analysis.toolRecovery.some((row) => row.unfinished > 0) ? (
									<span className="inline-flex items-center gap-4">
										<span className="size-8 rounded-sm bg-text-subtle" />
										{t("sessionInsights.errors.legend.unfinished")}
									</span>
								) : null}
								<span className="inline-flex items-center gap-4">
									<span className="size-8 rounded-sm bg-series-3" />
									{t("sessionInsights.errors.legend.switched")}
								</span>
								<IconTooltip label={how} align="start">
									<button
										type="button"
										data-testid="errors-heuristic"
										className="ml-auto rounded-sm text-text-subtle underline focus-visible:focus-ring"
									>
										{t("sessionInsights.errors.heuristic")}
									</button>
								</IconTooltip>
							</div>
							{analysis.toolRecovery.map((row) => (
								<div
									key={row.tool}
									data-testid="errors-tool-row"
									data-tool={row.tool}
									className="grid grid-cols-[minmax(80px,140px)_48px_minmax(0,1fr)_minmax(120px,auto)] items-center gap-8 border-border-muted border-t px-8 py-4 tr-text-metadata"
								>
									<span className="truncate tr-code-text-small text-text-default">{row.tool}</span>
									<span className="text-right text-text-muted tabular-nums">
										{formatCount(locale, row.failures)}
									</span>
									<ShareBar
										total={row.chains}
										parts={[
											{ key: "recovered", value: row.recovered, fill: "fill-feedback-success" },
											{ key: "changed", value: row.changedApproach, fill: "fill-series-8" },
											{ key: "gaveUp", value: row.gaveUp, fill: "fill-feedback-error" },
											{ key: "unfinished", value: row.unfinished, fill: "fill-text-subtle" },
										]}
									/>
									<span className="text-text-muted tabular-nums">
										{t("sessionInsights.errors.rate", {
											share: formatShare(locale, row.recovered, row.chains - row.unfinished) ?? "—",
											n: formatCount(locale, row.gaveUp),
										})}
									</span>
								</div>
							))}
							{models.failures > 0 ? (
								<div
									data-testid="errors-model-row"
									className="grid grid-cols-[minmax(80px,140px)_48px_minmax(0,1fr)_minmax(120px,auto)] items-center gap-8 border-border-muted border-t px-8 py-4 tr-text-metadata"
								>
									<span className="truncate text-text-default">
										{t("sessionInsights.errors.modelRow")}
									</span>
									<span className="text-right text-text-muted tabular-nums">
										{formatCount(locale, models.failures)}
									</span>
									<ShareBar
										total={models.chains}
										parts={[
											{ key: "same", value: models.sameModel, fill: "fill-feedback-success" },
											{ key: "switch", value: models.afterSwitch, fill: "fill-series-3" },
											{ key: "never", value: models.never, fill: "fill-feedback-error" },
										]}
									/>
									<span className="text-text-muted tabular-nums">
										{t("sessionInsights.errors.modelRate", {
											same: formatShare(locale, models.sameModel, models.chains) ?? "—",
											switched: formatShare(locale, models.afterSwitch, models.chains) ?? "—",
										})}
									</span>
								</div>
							) : null}
						</section>

						{retried.length > 0 ? (
							<section
								aria-label={t("sessionInsights.errors.chainsTitle")}
								className="flex flex-col gap-6"
							>
								<span className="tr-text-eyebrow text-text-muted">
									{t("sessionInsights.errors.chainsTitle")}
								</span>
								<ul className="flex flex-col gap-6">
									{retried.map((chain) => (
										<ChainCard
											key={chain.index}
											chain={chain}
											model={model}
											active={current?.index === chain.index}
											onOpen={() => onChain(chain.index)}
										/>
									))}
								</ul>
							</section>
						) : null}

						{single.length > 0 ? (
							<section className="flex flex-col gap-6">
								<Button
									variant="ghost"
									size="s"
									aria-expanded={showSingle}
									data-testid="errors-single-toggle"
									onClick={() => setShowSingle(!showSingle)}
								>
									{t("sessionInsights.errors.single", {
										count: single.length,
										n: formatCount(locale, single.length),
									})}
								</Button>
								{showSingle ? (
									<ul className="flex flex-col gap-6">
										{single.map((chain) => (
											<ChainCard
												key={chain.index}
												chain={chain}
												model={model}
												active={current?.index === chain.index}
												onOpen={() => onChain(chain.index)}
											/>
										))}
									</ul>
								) : null}
							</section>
						) : null}

						{analysis.repeats.length > 0 ? (
							<section
								aria-label={t("sessionInsights.errors.repeatsTitle")}
								className="flex flex-col gap-6"
							>
								<span className="tr-text-eyebrow text-text-muted">
									{t("sessionInsights.errors.repeatsTitle")}
								</span>
								<ul className="flex flex-col gap-4">
									{analysis.repeats.map((group) => (
										<li key={group.ids[0]}>
											<button
												type="button"
												data-testid="errors-repeat"
												onClick={() =>
													onShowInTrace(
														{
															ids: group.ids,
															label: t("sessionInsights.errors.repeatFocus", {
																tool: group.tool,
																n: group.ids.length,
															}),
														},
														group.ids[0] ?? "",
													)
												}
												className="flex w-full min-w-0 items-center gap-6 rounded-sm border border-border-default px-8 py-4 text-left tr-text-metadata hover:bg-control-bg-hovered focus-visible:focus-ring"
											>
												<RiRepeatLine
													aria-hidden
													className="size-14 shrink-0 text-feedback-warning"
												/>
												<span className="shrink-0 rounded-sm bg-feedback-warning-subtle px-4 text-feedback-warning tabular-nums">
													×{formatCount(locale, group.ids.length)}
												</span>
												<span className="shrink-0 tr-code-text-small text-text-default">
													{group.tool}
												</span>
												<span className="min-w-0 truncate tr-code-text-small text-text-muted">
													{group.label}
												</span>
												{group.errors > 0 ? (
													<span className="ml-auto shrink-0 inline-flex items-center gap-2 text-feedback-error">
														<RiErrorWarningLine aria-hidden className="size-12" />
														{formatCount(locale, group.errors)}
													</span>
												) : null}
											</button>
										</li>
									))}
								</ul>
							</section>
						) : null}
					</div>
				</div>
			</ResizablePanel>
			<ResizableHandle direction={stacked ? "vertical" : "horizontal"} />
			<ResizablePanel defaultSize={42} minSize={25}>
				<div
					className={cn("h-full min-h-0 border-border-default", stacked ? "border-t" : "border-l")}
				>
					{current ? (
						<ChainDetail
							key={current.index}
							host={host}
							sessionId={sessionId}
							chain={current}
							model={model}
							onShowInTrace={onShowInTrace}
						/>
					) : (
						<p className="p-16 tr-text-metadata text-text-subtle">
							{t("sessionInsights.errors.pick")}
						</p>
					)}
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
