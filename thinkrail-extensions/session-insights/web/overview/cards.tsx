import {
	type RemixiconComponentType,
	RiArrowRightLine,
	RiArrowRightSLine,
	RiArrowRightUpLine,
	RiChat3Line,
	RiCheckboxBlankCircleLine,
	RiCheckboxCircleLine,
	RiCheckLine,
	RiCloseLine,
	RiDatabase2Line,
	RiErrorWarningLine,
	RiFileEditLine,
	RiLightbulbLine,
	RiMoneyDollarCircleLine,
	RiPlayCircleLine,
	RiRobot2Line,
} from "@remixicon/react";
import { localeOf, useT } from "@thinkrail/locales/react";
import type {
	Figure,
	MetricId,
	OverviewPlanStep,
	PlanStatus,
	SessionOverviewCards,
} from "@thinkrail/pi-session-insights/core";
import { DiffStatBadge } from "@thinkrail/ui/diff-stat-badge";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useId, useState } from "react";
import { isBadged, SEVERITY_TONE } from "../copy";
import { diagnosisText, valueText } from "../cost/diagnosis";
import { FigureBadge, FigureDetails, type FigureView, type Sources } from "../FigureCell";
import {
	formatClock,
	formatCount,
	formatDuration,
	formatPercent,
	formatSpan,
	formatTokens,
} from "../format";
import { drawActivityStrip } from "../subagents/draw";
import { PLAN_STATUS_LABEL } from "../trace/bandCopy";
import { useCanvasLook } from "../trace/look";
import { StripCanvas } from "../trace/StripCanvas";
import { findingText } from "./findings";
import type { OverviewLink } from "./OverviewView";

type Open = (link: OverviewLink) => void;

interface CardProps {
	cards: SessionOverviewCards;
	sources: Sources;
	onOpen: Open;
}

const W = 1000;
const H = 40;

const STATUS_ICON = {
	done: RiCheckLine,
	inProgress: RiPlayCircleLine,
	pending: RiCheckboxBlankCircleLine,
	promoted: RiArrowRightUpLine,
	removed: RiCloseLine,
} as const satisfies Record<PlanStatus, RemixiconComponentType>;

const STATUS_TONE = {
	done: "text-feedback-success",
	inProgress: "text-primary",
	pending: "text-text-subtle",
	promoted: "text-text-muted",
	removed: "text-text-subtle",
} as const satisfies Record<PlanStatus, string>;

function view(metric: MetricId, figure: Figure, exact: string | null): FigureView {
	return { metric, origin: figure.origin, exact };
}

/** A link into a section; it carries its target so a test can read where it leads. */
export function CardLink({
	link,
	onOpen,
	testId,
	label,
	className,
	children,
}: {
	link: OverviewLink;
	onOpen: Open;
	testId: string;
	label?: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			data-testid={testId}
			data-link={JSON.stringify(link)}
			aria-label={label}
			onClick={() => onOpen(link)}
			className={cn(
				"inline-flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:focus-ring",
				className,
			)}
		>
			{children}
		</button>
	);
}

/** Text whose figures keep their provenance tooltip; badged when one of them is not exact. */
function FigureText({
	figures,
	sources,
	testId,
	className,
	children,
}: {
	figures: readonly FigureView[];
	sources: Sources;
	testId?: string;
	className?: string;
	children: ReactNode;
}) {
	const badged = figures.find((figure) => isBadged(figure.origin))?.origin;
	return (
		<IconTooltip label={<FigureDetails figures={figures} sources={sources} />} align="start">
			<button
				type="button"
				data-testid={testId}
				className={cn(
					"inline-flex min-w-0 max-w-full items-center gap-4 rounded-sm text-left tabular-nums focus-visible:focus-ring",
					className,
				)}
			>
				<span className="min-w-0">{children}</span>
				{badged && isBadged(badged) ? <FigureBadge origin={badged} /> : null}
			</button>
		</IconTooltip>
	);
}

function Card({
	testId,
	icon: Icon,
	title,
	link,
	className,
	children,
}: {
	testId: string;
	icon: RemixiconComponentType;
	title: ReactNode;
	link: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<section
			data-testid={testId}
			aria-labelledby={id}
			className={cn(
				"flex min-w-0 flex-col gap-8 rounded-md border border-border-default p-12",
				className,
			)}
		>
			<CardHeader id={id} icon={Icon} title={title} link={link} />
			{children}
		</section>
	);
}

function CardHeader({
	id,
	icon: Icon,
	title,
	link,
}: {
	id: string;
	icon: RemixiconComponentType;
	title: ReactNode;
	link: ReactNode;
}) {
	return (
		<header className="flex min-w-0 items-center gap-6">
			<Icon aria-hidden className="size-16 shrink-0 text-text-muted" />
			<h3 id={id} className="flex min-w-0 flex-1 tr-text-emphasis text-text-default">
				{title}
			</h3>
			{link}
		</header>
	);
}

function SectionLink({
	link,
	onOpen,
	testId,
	children,
}: {
	link: OverviewLink;
	onOpen: Open;
	testId: string;
	children: ReactNode;
}) {
	return (
		<CardLink
			link={link}
			onOpen={onOpen}
			testId={testId}
			className="shrink-0 tr-text-metadata text-primary hover:underline"
		>
			{children}
			<RiArrowRightSLine aria-hidden className="size-14" />
		</CardLink>
	);
}

function Empty({ testId, children }: { testId: string; children: ReactNode }) {
	return (
		<p data-testid={testId} className="tr-text-ui text-text-muted">
			{children}
		</p>
	);
}

// ── What happened ──

function happenedText(t: ReturnType<typeof useT>, cards: SessionOverviewCards): string {
	const locale = localeOf(t);
	const { happened } = cards;
	const count = (figure: Figure) => figure.value ?? 0;
	const failed = count(happened.toolFailures);
	const recovered = count(happened.recovered);
	const failures =
		failed === 0
			? ""
			: recovered === failed
				? t("sessionInsights.overview.happened.failedRecovered", {
						count: failed,
						n: formatCount(locale, failed),
					})
				: recovered > 0
					? t("sessionInsights.overview.happened.failedPartly", {
							count: failed,
							n: formatCount(locale, failed),
							recovered: formatCount(locale, recovered),
						})
					: t("sessionInsights.overview.happened.failedNone", {
							count: failed,
							n: formatCount(locale, failed),
						});
	const params = {
		turns: t("sessionInsights.overview.happened.turns", {
			count: count(happened.turns),
			n: formatCount(locale, count(happened.turns)),
		}),
		work: t("sessionInsights.overview.happened.work", {
			llm: t("sessionInsights.turns.llmCalls", {
				count: count(happened.llmCalls),
				n: formatCount(locale, count(happened.llmCalls)),
			}),
			tools: t("sessionInsights.turns.toolCalls", {
				count: count(happened.toolCalls),
				n: formatCount(locale, count(happened.toolCalls)),
			}),
			failures,
		}),
	};
	const lead =
		happened.outcome === "succeeded"
			? t("sessionInsights.overview.happened.lead.succeeded", params)
			: happened.outcome === "failed"
				? t("sessionInsights.overview.happened.lead.failed", params)
				: happened.outcome === "interrupted"
					? t("sessionInsights.overview.happened.lead.interrupted", params)
					: happened.outcome === "cancelled"
						? t("sessionInsights.overview.happened.lead.cancelled", params)
						: t("sessionInsights.overview.happened.lead.none", params);
	const wait = count(happened.userWait);
	return `${lead} ${
		wait > 0
			? t("sessionInsights.overview.happened.waited", { duration: formatDuration(t, wait) })
			: t("sessionInsights.overview.happened.waitedNever")
	}`;
}

function ActivityStrip({ cards, onOpen }: { cards: SessionOverviewCards; onOpen: Open }) {
	const t = useT();
	const locale = localeOf(t);
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const { palette } = useCanvasLook(root);
	const { activity, start, end, span } = cards.happened;
	if (!activity || start.value === null || end.value === null) return null;
	return (
		<div ref={setRoot} className="flex min-w-0 flex-col gap-2">
			<CardLink
				link={{ to: "trace", mode: "timeline" }}
				onOpen={onOpen}
				testId="overview-activity"
				label={t("sessionInsights.overview.happened.openTimeline")}
				className="w-full"
			>
				<StripCanvas
					className="h-24 w-full"
					draw={
						palette
							? (context, width, height) =>
									drawActivityStrip(context, width, height, activity, palette)
							: null
					}
				/>
			</CardLink>
			<span className="flex justify-between gap-8 tr-text-metadata text-text-subtle tabular-nums">
				<span>{formatClock(locale, start.value, true)}</span>
				<span>{span.value === null ? null : formatDuration(t, span.value, true)}</span>
				<span>{formatClock(locale, end.value, true)}</span>
			</span>
		</div>
	);
}

function PlanRow({
	step,
	cards,
	sources,
	onOpen,
}: {
	step: OverviewPlanStep;
	cards: SessionOverviewCards;
	sources: Sources;
	onOpen: Open;
}) {
	const t = useT();
	const locale = localeOf(t);
	const Icon = STATUS_ICON[step.status];
	const failures = step.errors.value ?? 0;
	const spend = cards.cost.headline === "tokens" ? step.tokens : step.cost;
	const body = (
		<>
			<span className="w-16 shrink-0 text-right text-text-subtle tabular-nums">
				{formatCount(locale, step.n)}
			</span>
			<Icon aria-hidden className={cn("size-14 shrink-0", STATUS_TONE[step.status])} />
			<span className="sr-only">{t(PLAN_STATUS_LABEL[step.status])}</span>
			<span className="min-w-0 truncate text-text-default">{step.title}</span>
			{failures > 0 ? (
				<span className="shrink-0 text-feedback-error">
					{t("sessionInsights.overview.failures", {
						count: failures,
						n: formatCount(locale, failures),
					})}
				</span>
			) : null}
		</>
	);
	return (
		<li
			data-testid="overview-plan-step"
			data-status={step.status}
			className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-8 tr-text-metadata"
		>
			{step.events.length > 0 ? (
				<CardLink
					link={{ to: "trace", events: step.events }}
					onOpen={onOpen}
					testId="overview-plan-link"
					className="gap-6 hover:underline"
				>
					{body}
				</CardLink>
			) : (
				<span className="flex min-w-0 items-center gap-6">{body}</span>
			)}
			<FigureText
				figures={[
					view(
						cards.cost.headline === "tokens" ? "tokens" : "cost",
						spend,
						valueText(locale, cards.cost, spend.value ?? 0),
					),
				]}
				sources={sources}
				className="text-text-muted"
			>
				{valueText(locale, cards.cost, spend.value ?? 0)}
			</FigureText>
		</li>
	);
}

export function HappenedCard({ cards, sources, onOpen }: CardProps) {
	const t = useT();
	const locale = localeOf(t);
	const { happened } = cards;
	const plan = happened.plan;
	const exact = (figure: Figure) =>
		figure.value === null ? null : formatCount(locale, figure.value);
	return (
		<Card
			testId="overview-happened"
			icon={RiCheckboxCircleLine}
			title={t("sessionInsights.overview.happened.title")}
			link={
				<SectionLink link={{ to: "trace" }} onOpen={onOpen} testId="overview-link-trace">
					{t("sessionInsights.overview.link.trace")}
				</SectionLink>
			}
		>
			<FigureText
				testId="overview-happened-sentence"
				figures={[
					view("turns", happened.turns, exact(happened.turns)),
					view("llmCalls", happened.llmCalls, exact(happened.llmCalls)),
					view("toolCalls", happened.toolCalls, exact(happened.toolCalls)),
					view("toolErrors", happened.toolFailures, exact(happened.toolFailures)),
					view("recovery", happened.recovered, exact(happened.recovered)),
					view(
						"userWait",
						happened.userWait,
						happened.userWait.value === null
							? null
							: formatDuration(t, happened.userWait.value, true),
					),
				]}
				sources={sources}
				className="tr-text-ui text-text-default"
			>
				{happenedText(t, cards)}
			</FigureText>
			<ActivityStrip cards={cards} onOpen={onOpen} />
			{plan ? (
				<div data-testid="overview-plan" className="flex min-w-0 flex-col gap-4">
					<FigureText
						figures={[
							view("plan", plan.done, exact(plan.done)),
							view("plan", plan.total, exact(plan.total)),
						]}
						sources={sources}
						className="tr-text-caption text-text-subtle"
					>
						{t("sessionInsights.overview.plan.title", {
							done: formatCount(locale, plan.done.value ?? 0),
							total: formatCount(locale, plan.total.value ?? 0),
						})}
					</FigureText>
					<ol className="flex min-w-0 flex-col gap-2">
						{plan.steps.map((step) => (
							<PlanRow key={step.id} step={step} cards={cards} sources={sources} onOpen={onOpen} />
						))}
					</ol>
					{plan.more > 0 ? (
						<span className="tr-text-metadata text-text-subtle">
							{t("sessionInsights.overview.plan.more", {
								count: plan.more,
								n: formatCount(locale, plan.more),
							})}
						</span>
					) : null}
				</div>
			) : null}
			{happened.skills.length > 0 ? (
				<div data-testid="overview-skills" className="flex min-w-0 flex-wrap items-center gap-4">
					<span className="tr-text-metadata text-text-muted">
						{t("sessionInsights.overview.skills")}
					</span>
					{happened.skills.map((skill) => (
						<span
							key={skill}
							className="rounded-sm border border-border-default px-4 tr-code-text-small text-text-default"
						>
							{skill}
						</span>
					))}
				</div>
			) : null}
		</Card>
	);
}

// ── Why it cost what it did ──

function CostBars({ cards }: { cards: SessionOverviewCards }) {
	const t = useT();
	const locale = localeOf(t);
	const { bars, perBar, calls, headline } = cards.cost;
	const max = Math.max(0, ...bars);
	if (bars.length === 0 || max <= 0) return null;
	const width = W / bars.length;
	let path = "";
	bars.forEach((value, at) => {
		const h = (value / max) * (H - 1);
		if (h > 0)
			path += `M${(at * width + width * 0.1).toFixed(2)} ${H}v${(-h).toFixed(2)}h${(width * 0.8).toFixed(2)}v${h.toFixed(2)}z`;
	});
	const n = calls.value ?? 0;
	return (
		<figure data-testid="overview-cost-bars" className="flex min-w-0 flex-col gap-2">
			<svg
				role="img"
				aria-label={t("sessionInsights.overview.cost.chart")}
				viewBox={`0 0 ${W} ${H}`}
				preserveAspectRatio="none"
				className="block h-40 w-full"
			>
				<path d={path} className="fill-series-3" />
			</svg>
			<figcaption className="flex flex-wrap gap-x-8 tr-text-metadata text-text-subtle tabular-nums">
				<span>
					{t(
						headline === "tokens"
							? "sessionInsights.overview.cost.barsTokens"
							: "sessionInsights.overview.cost.bars",
						{ count: n, n: formatCount(locale, n) },
					)}
				</span>
				{perBar > 1 ? (
					<span>
						{t("sessionInsights.overview.cost.perBar", {
							count: perBar,
							n: formatCount(locale, perBar),
						})}
					</span>
				) : null}
			</figcaption>
		</figure>
	);
}

function Findings({ cards, onOpen }: { cards: SessionOverviewCards; onOpen: Open }) {
	const t = useT();
	const locale = localeOf(t);
	const id = useId();
	const { findings, digests } = cards;
	return (
		<section
			data-testid="overview-findings"
			aria-labelledby={id}
			className="flex min-w-0 flex-col gap-4 border-border-muted border-t pt-8"
		>
			<CardHeader
				id={id}
				icon={RiLightbulbLine}
				title={t("sessionInsights.overview.findings.title")}
				link={
					<SectionLink link={{ to: "findings" }} onOpen={onOpen} testId="overview-link-findings">
						{t("sessionInsights.overview.findings.whatToDo")}
					</SectionLink>
				}
			/>
			{findings === null ? (
				<p
					data-testid="overview-findings-counting"
					role="status"
					className="tr-text-metadata text-text-muted"
				>
					{t("sessionInsights.overview.findings.counting", {
						ready: formatCount(locale, digests.ready),
						total: formatCount(locale, digests.total),
					})}
				</p>
			) : findings.length === 0 ? (
				<Empty testId="overview-findings-none">{t("sessionInsights.overview.findings.none")}</Empty>
			) : (
				<ul className="flex min-w-0 flex-col gap-2">
					{findings.map((finding) => (
						<li
							key={finding.id}
							data-testid="overview-finding"
							data-rule={finding.rule}
							data-severity={finding.severity}
							className="flex min-w-0 items-start gap-6 tr-text-ui text-text-default"
						>
							<RiLightbulbLine
								aria-hidden
								className={cn("mt-2 size-14 shrink-0", SEVERITY_TONE[finding.severity])}
							/>
							<span className="min-w-0">{findingText(t, finding)}</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

export function CostCard({ cards, sources, onOpen }: CardProps) {
	const t = useT();
	const locale = localeOf(t);
	const { cost } = cards;
	const total = valueText(locale, cost, cost.total.value ?? 0);
	const count = (figure: Figure) => figure.value ?? 0;
	const chips: { key: string; figure: FigureView; text: string; tone?: "warning" | "error" }[] = [];
	if (cost.cacheShare.value !== null)
		chips.push({
			key: "read",
			figure: view("cacheShare", cost.cacheShare, formatPercent(locale, cost.cacheShare.value)),
			text: t("sessionInsights.overview.cost.chip.cacheRead", {
				share: formatPercent(locale, cost.cacheShare.value),
			}),
		});
	chips.push({
		key: "rewrites",
		figure: view("cacheMisses", cost.rewrites, formatCount(locale, count(cost.rewrites))),
		text: t("sessionInsights.overview.cost.chip.rewrites", {
			count: count(cost.rewrites),
			n: formatCount(locale, count(cost.rewrites)),
		}),
		...(count(cost.rewrites) > 0 ? { tone: "error" as const } : {}),
	});
	chips.push({
		key: "compactions",
		figure: view("contextTokens", cost.compactions, formatCount(locale, count(cost.compactions))),
		text: t("sessionInsights.overview.cost.chip.compactions", {
			count: count(cost.compactions),
			n: formatCount(locale, count(cost.compactions)),
		}),
	});
	if (cost.highContext.value !== null)
		chips.push({
			key: "high",
			figure: view("contextWindow", cost.highContext, formatCount(locale, cost.highContext.value)),
			text: t("sessionInsights.overview.cost.chip.highContext", {
				count: cost.highContext.value,
				n: formatCount(locale, cost.highContext.value),
			}),
			...(cost.highContext.value > 0 ? { tone: "warning" as const } : {}),
		});
	return (
		<Card
			testId="overview-cost"
			icon={RiMoneyDollarCircleLine}
			title={
				<FigureText
					testId="overview-cost-total"
					figures={[view(cost.headline === "tokens" ? "tokens" : "cost", cost.total, total)]}
					sources={sources}
				>
					{t(
						cost.headline === "tokens"
							? "sessionInsights.overview.cost.titleTokens"
							: "sessionInsights.overview.cost.title",
						{ value: total },
					)}
				</FigureText>
			}
			link={
				<SectionLink
					link={{ to: "cost", view: "cost" }}
					onOpen={onOpen}
					testId="overview-link-cost"
				>
					{t("sessionInsights.overview.link.costContext")}
				</SectionLink>
			}
		>
			<p
				data-testid="overview-diagnosis"
				data-kind={cost.diagnosis.kind}
				className="tr-text-ui text-text-default"
			>
				{diagnosisText(t, locale, cost)}
			</p>
			<span className="tr-text-metadata text-text-subtle">
				{t("sessionInsights.overview.cost.note")}
			</span>
			<ul data-testid="overview-cost-chips" className="flex flex-wrap gap-4">
				{chips.map((chip) => (
					<li key={chip.key}>
						<FigureText
							figures={[chip.figure]}
							sources={sources}
							className={cn(
								"rounded-full border px-8 py-2 tr-text-metadata",
								chip.tone === "warning"
									? "border-feedback-warning-muted text-feedback-warning"
									: chip.tone === "error"
										? "border-feedback-error-muted text-feedback-error"
										: "border-border-default text-text-muted",
							)}
						>
							{chip.text}
						</FigureText>
					</li>
				))}
			</ul>
			<CostBars cards={cards} />
			<Findings cards={cards} onOpen={onOpen} />
		</Card>
	);
}

// ── Errors ──

export function ErrorsCard({ cards, sources, onOpen }: CardProps) {
	const t = useT();
	const locale = localeOf(t);
	const errors = cards.errors;
	const chain = errors?.chain ?? null;
	return (
		<Card
			testId="overview-errors"
			icon={RiErrorWarningLine}
			title={t("sessionInsights.overview.errors.title")}
			link={
				<SectionLink link={{ to: "errors" }} onOpen={onOpen} testId="overview-link-errors">
					{t("sessionInsights.overview.link.errors")}
				</SectionLink>
			}
		>
			{errors ? (
				<>
					<FigureText
						testId="overview-errors-summary"
						figures={[
							view("errors", errors.failures, formatCount(locale, errors.failures.value ?? 0)),
							view("recovery", errors.recovered, formatCount(locale, errors.recovered.value ?? 0)),
						]}
						sources={sources}
						className="tr-text-ui text-text-default"
					>
						{t("sessionInsights.overview.failures", {
							count: errors.failures.value ?? 0,
							n: formatCount(locale, errors.failures.value ?? 0),
						})}
						{" · "}
						<span
							className={
								(errors.recovered.value ?? 0) > 0 ? "text-feedback-success" : "text-feedback-error"
							}
						>
							{(errors.recovered.value ?? 0) > 0
								? t("sessionInsights.overview.errors.recoveredIn", {
										count: errors.recovered.value ?? 0,
										n: formatCount(locale, errors.recovered.value ?? 0),
										time: formatSpan(t, locale, errors.recoveredIn.value ?? 0),
									})
								: t("sessionInsights.overview.errors.recoveredNone")}
						</span>
					</FigureText>
					{chain ? (
						<CardLink
							link={{ to: "errors", chain: chain.index }}
							onOpen={onOpen}
							testId="overview-chain"
							label={t("sessionInsights.overview.errors.openChain")}
							className="flex-col items-start gap-4 rounded-md p-2 hover:bg-control-bg-hovered"
						>
							<span className="flex min-w-0 flex-wrap items-center gap-4">
								{chain.attempts.map((attempt, at) => (
									<span key={attempt.eventId} className="inline-flex min-w-0 items-center gap-4">
										{at > 0 ? (
											<span className="inline-flex items-center gap-2 tr-text-metadata text-text-subtle">
												{(chain.between[at - 1] ?? 0) > 0 ? (
													<span>
														{t("sessionInsights.errors.between", {
															count: chain.between[at - 1] ?? 0,
															n: formatCount(locale, chain.between[at - 1] ?? 0),
														})}
													</span>
												) : null}
												<RiArrowRightLine aria-hidden className="size-12" />
											</span>
										) : null}
										<span
											data-testid="overview-attempt"
											data-failed={attempt.failed}
											data-missing={attempt.missing ? "true" : undefined}
											title={attempt.label}
											className={cn(
												"inline-flex items-center gap-2 rounded-sm border px-4 tr-code-text-small",
												attempt.missing
													? "border-border-default border-dashed text-text-muted"
													: attempt.failed
														? "border-feedback-error-muted text-feedback-error"
														: "border-feedback-success-muted text-feedback-success",
											)}
										>
											{`#${at + 1} ${attempt.name ?? ""}`}
											{attempt.missing ? (
												<span>{t("sessionInsights.trace.noResult")}</span>
											) : attempt.failed ? (
												<RiCloseLine aria-hidden className="size-12" />
											) : (
												<RiCheckLine aria-hidden className="size-12" />
											)}
										</span>
									</span>
								))}
							</span>
							{chain.line ? (
								<span className="line-clamp-3 tr-code-text-small text-feedback-error">
									{chain.line}
								</span>
							) : null}
						</CardLink>
					) : null}
				</>
			) : (
				<Empty testId="overview-errors-none">{t("sessionInsights.overview.errors.none")}</Empty>
			)}
		</Card>
	);
}

// ── Context and cache ──

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<dt className="text-text-muted">{label}</dt>
			<dd className="min-w-0 text-text-default">{children}</dd>
		</>
	);
}

export function ContextCard({ cards, sources, onOpen }: CardProps) {
	const t = useT();
	const locale = localeOf(t);
	const { context } = cards;
	const tokens = (figure: Figure) =>
		figure.value === null ? "—" : formatTokens(locale, figure.value);
	return (
		<Card
			testId="overview-context"
			icon={RiDatabase2Line}
			title={t("sessionInsights.overview.context.title")}
			link={
				<SectionLink
					link={{ to: "cost", view: "context" }}
					onOpen={onOpen}
					testId="overview-link-context"
				>
					{t("sessionInsights.overview.link.costContext")}
				</SectionLink>
			}
		>
			{context.peak.value === null ? (
				<Empty testId="overview-context-none">{t("sessionInsights.context.empty")}</Empty>
			) : (
				<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-12 gap-y-2 tr-text-metadata">
					<Row label={t("sessionInsights.context.peak")}>
						<FigureText
							testId="overview-context-peak"
							figures={[
								view("contextTokens", context.peak, formatCount(locale, context.peak.value)),
								...(context.window.value !== null
									? [
											view(
												"contextWindow",
												context.window,
												formatCount(locale, context.window.value),
											),
										]
									: []),
							]}
							sources={sources}
						>
							{tokens(context.peak)}
							{context.peakShare.value !== null && context.window.value !== null ? (
								<span className="text-text-subtle">
									{" · "}
									{t("sessionInsights.context.ofWindowShort", {
										share: formatPercent(locale, context.peakShare.value, 1),
										window: formatTokens(locale, context.window.value),
									})}
								</span>
							) : null}
						</FigureText>
					</Row>
					<Row label={t("sessionInsights.context.average")}>
						<FigureText
							figures={[
								view(
									"contextTokens",
									context.average,
									context.average.value === null
										? null
										: formatCount(locale, context.average.value),
								),
							]}
							sources={sources}
						>
							{tokens(context.average)}
						</FigureText>
					</Row>
					<Row label={t("sessionInsights.context.cacheShare")}>
						<FigureText
							figures={[
								view(
									"cacheShare",
									context.cacheShare,
									context.cacheShare.value === null
										? null
										: formatPercent(locale, context.cacheShare.value),
								),
							]}
							sources={sources}
						>
							{context.cacheShare.value === null
								? "—"
								: formatPercent(locale, context.cacheShare.value)}
						</FigureText>
					</Row>
					<Row label={t("sessionInsights.context.misses")}>
						<FigureText
							figures={[
								view("cacheMisses", context.misses, formatCount(locale, context.misses.value ?? 0)),
							]}
							sources={sources}
							className={cn((context.misses.value ?? 0) > 0 && "text-feedback-warning")}
						>
							{formatCount(locale, context.misses.value ?? 0)}
						</FigureText>
					</Row>
					<Row label={t("sessionInsights.context.compactions")}>
						<FigureText
							figures={[
								view(
									"contextTokens",
									context.compactions,
									formatCount(locale, context.compactions.value ?? 0),
								),
							]}
							sources={sources}
						>
							{formatCount(locale, context.compactions.value ?? 0)}
						</FigureText>
					</Row>
				</dl>
			)}
		</Card>
	);
}

// ── Files ──

function splitPath(path: string): { folder: string; name: string } {
	const at = path.lastIndexOf("/");
	return at < 0
		? { folder: "", name: path }
		: { folder: path.slice(0, at + 1), name: path.slice(at + 1) };
}

export function FilesCard({ cards, sources, onOpen }: CardProps) {
	const t = useT();
	const locale = localeOf(t);
	const { files } = cards;
	const { totals } = files;
	return (
		<Card
			testId="overview-files"
			icon={RiFileEditLine}
			title={t("sessionInsights.overview.files.title")}
			link={
				<SectionLink link={{ to: "files" }} onOpen={onOpen} testId="overview-link-files">
					{t("sessionInsights.overview.link.files")}
				</SectionLink>
			}
		>
			{files.rows.length === 0 ? (
				<Empty testId="overview-files-none">{t("sessionInsights.overview.files.none")}</Empty>
			) : (
				<>
					<FigureText
						testId="overview-files-summary"
						figures={[
							{
								metric: "fileTouches",
								origin: "counted",
								exact: formatCount(locale, totals.changed),
							},
							{
								metric: "fileLines",
								origin: "counted",
								exact: `+${formatCount(locale, totals.added)} −${formatCount(locale, totals.removed)}`,
							},
						]}
						sources={sources}
						className="tr-text-metadata text-text-default"
					>
						{t("sessionInsights.overview.files.changed", {
							count: totals.changed,
							n: formatCount(locale, totals.changed),
						})}
						{totals.added + totals.removed > 0 ? (
							<>
								{" · "}
								<DiffStatBadge added={totals.added} removed={totals.removed} />
							</>
						) : null}
						{totals.failed > 0 ? (
							<span className="text-feedback-error">
								{" · "}
								{t("sessionInsights.overview.files.failed", {
									count: totals.failed,
									n: formatCount(locale, totals.failed),
								})}
							</span>
						) : null}
					</FigureText>
					<ul className="flex min-w-0 flex-col gap-2">
						{files.rows.map((row) => {
							const { folder, name } = splitPath(row.path);
							return (
								<li key={row.path} data-testid="overview-file" className="min-w-0">
									<CardLink
										link={{ to: "files", path: row.path }}
										onOpen={onOpen}
										testId="overview-file-link"
										className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-8 tr-code-text-small hover:underline"
									>
										<span className="flex min-w-0">
											<span className="min-w-0 truncate text-text-subtle">{folder}</span>
											<span className="shrink-0 text-text-default">{name}</span>
										</span>
										<span className="flex items-center gap-4">
											{row.failed ? (
												<span className="text-feedback-error">
													<span aria-hidden>◆</span>
													<span className="sr-only">
														{t("sessionInsights.overview.files.failedMark")}
													</span>
												</span>
											) : null}
											{row.rework ? (
												<span className="tr-text-caption text-feedback-error">
													{t("sessionInsights.overview.files.reworkMark")}
												</span>
											) : null}
											<DiffStatBadge added={row.added} removed={row.removed} />
										</span>
									</CardLink>
								</li>
							);
						})}
					</ul>
					{files.more > 0 ? (
						<span className="tr-text-metadata text-text-subtle">
							{t("sessionInsights.overview.files.more", {
								count: files.more,
								n: formatCount(locale, files.more),
							})}
						</span>
					) : null}
				</>
			)}
		</Card>
	);
}

// ── Subagents and turns ──

export function SubagentsCard({ cards, sources, onOpen }: CardProps) {
	const t = useT();
	const locale = localeOf(t);
	const turnsId = useId();
	const { subagents, turns } = cards;
	const overview = subagents.overview;
	const count = subagents.count.value ?? 0;
	const prompts = turns.prompts.value ?? 0;
	const asks = turns.asks.value ?? 0;
	const byCost = (overview?.cost.value ?? 0) > 0;
	const spend = overview ? (byCost ? overview.cost : overview.tokens) : null;
	const spendText = spend
		? byCost
			? valueText(locale, { headline: "cost" }, spend.value ?? 0)
			: formatTokens(locale, spend.value ?? 0)
		: "";
	return (
		<Card
			testId="overview-subagents"
			icon={RiRobot2Line}
			title={t("sessionInsights.overview.subagents.title")}
			link={
				<SectionLink link={{ to: "subagents" }} onOpen={onOpen} testId="overview-link-subagents">
					{t("sessionInsights.overview.link.subagents")}
				</SectionLink>
			}
		>
			{overview && count > 0 ? (
				<div className="flex min-w-0 flex-col gap-4">
					<FigureText
						testId="overview-subagents-summary"
						figures={[
							view("subagentRun", subagents.count, formatCount(locale, count)),
							...(spend ? [view(byCost ? "cost" : "tokens", spend, spendText)] : []),
						]}
						sources={sources}
						className="tr-text-metadata text-text-default"
					>
						{t("sessionInsights.overview.subagents.summary", {
							count,
							n: formatCount(locale, count),
							parallel: formatCount(locale, overview.maxParallel),
						})}
						{spend ? (
							<span className="text-text-muted">
								{" · "}
								{spendText}
							</span>
						) : null}
					</FigureText>
					<span className="flex min-w-0 flex-wrap gap-4">
						{overview.roles.map((role) => (
							<span
								key={role.role ?? ""}
								className="rounded-sm border border-border-default px-4 tr-text-metadata text-text-muted"
							>
								{`${role.role ?? t("sessionInsights.overview.subagents.noRole")} ×${formatCount(locale, role.n)}`}
							</span>
						))}
					</span>
					{overview.failed > 0 ? (
						<span className="tr-text-metadata text-feedback-error">
							{t("sessionInsights.overview.subagents.failed", {
								count: overview.failed,
								n: formatCount(locale, overview.failed),
							})}
						</span>
					) : null}
				</div>
			) : (
				<Empty testId="overview-subagents-none">
					{t("sessionInsights.overview.subagents.none")}
				</Empty>
			)}
			<section
				data-testid="overview-turns"
				aria-labelledby={turnsId}
				className="flex min-w-0 flex-col gap-4 border-border-muted border-t pt-8"
			>
				<CardHeader
					id={turnsId}
					icon={RiChat3Line}
					title={t("sessionInsights.overview.turns.title")}
					link={
						<SectionLink
							link={{ to: "trace", mode: "turns" }}
							onOpen={onOpen}
							testId="overview-link-turns"
						>
							{t("sessionInsights.overview.link.turns")}
						</SectionLink>
					}
				/>
				<FigureText
					testId="overview-turns-summary"
					figures={[
						view("turns", turns.prompts, formatCount(locale, prompts)),
						view("userWait", turns.asks, formatCount(locale, asks)),
					]}
					sources={sources}
					className="tr-text-metadata text-text-default"
				>
					{t("sessionInsights.overview.turns.summary", {
						prompts: t("sessionInsights.overview.turns.prompts", {
							count: prompts,
							n: formatCount(locale, prompts),
						}),
						asks:
							asks > 0
								? t("sessionInsights.overview.turns.asks", {
										count: asks,
										n: formatCount(locale, asks),
									})
								: t("sessionInsights.overview.turns.noAsks"),
					})}
				</FigureText>
			</section>
		</Card>
	);
}
