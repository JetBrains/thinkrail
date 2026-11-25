import {
	type RemixiconComponentType,
	RiArrowGoBackLine,
	RiChatQuoteLine,
	RiCheckDoubleLine,
	RiCoinLine,
	RiDatabase2Line,
	RiExpandHeightLine,
	RiEyeLine,
	RiEyeOffLine,
	RiFileEditLine,
	RiFilter3Line,
	RiInformationLine,
	RiLightbulbLine,
	RiRepeatLine,
	RiRobot2Line,
	RiStackLine,
	RiTerminalBoxLine,
	RiTestTubeLine,
} from "@remixicon/react";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	DiffSegment,
	ExitMeaning,
	Finding,
	FindingGroup,
	FindingRule,
	FindingSeverity,
	FindingsListResult,
	MissCause,
	Rate,
	SessionRef,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { SEVERITY_PILL, SEVERITY_TONE, sessionName } from "../copy";
import { FigureDetails, type FigureView, Pill } from "../FigureCell";
import { formatCost, formatCount, formatShare, formatTokens } from "../format";
import {
	EXIT_MEANING,
	EXIT_TEMPLATE,
	GROUP_LABEL,
	GROUP_NOTE,
	MISS_CAUSE_LABEL,
	RULE_ACTION,
	RULE_TEMPLATE,
	RULE_TITLE,
	RULE_WHY,
	SEVERITY_LABEL,
} from "./copy";

const GROUPS: readonly FindingGroup[] = ["skills", "commands", "context", "files"];

const WHY_COUNTS_TOTAL: ReadonlySet<FindingRule> = new Set([
	"cacheMisses",
	"commandFailing",
	"costOutlier",
	"falseError",
	"poorRecovery",
	"tokenOutlier",
]);
const SEVERITIES: readonly FindingSeverity[] = ["error", "warning", "info"];
const LINKS_SHOWN = 4;

const RULE_ICON = {
	skillNeverLoaded: RiLightbulbLine,
	skillUnlisted: RiInformationLine,
	commandFailing: RiTerminalBoxLine,
	falseError: RiCheckDoubleLine,
	loop: RiRepeatLine,
	poorRecovery: RiArrowGoBackLine,
	oversizedOutput: RiExpandHeightLine,
	contextLimit: RiStackLine,
	cacheMisses: RiDatabase2Line,
	costOutlier: RiCoinLine,
	tokenOutlier: RiCoinLine,
	subagentsOutside: RiRobot2Line,
	rework: RiFileEditLine,
	repeatedInstruction: RiChatQuoteLine,
	unverifiedClaim: RiTestTubeLine,
} as const satisfies Record<FindingRule, RemixiconComponentType>;

const EXIT_MEANINGS: readonly string[] = [
	"checksPending",
	"noMatch",
	"differences",
	"conditionFalse",
] satisfies readonly ExitMeaning[];

function isMeaning(value: string): value is ExitMeaning {
	return EXIT_MEANINGS.includes(value);
}

const CAUSES: readonly string[] = [
	"modelChange",
	"modelReselected",
	"systemPrompt",
	"tools",
	"compaction",
	"contextEdit",
	"thinkingLevel",
	"pause",
	"none",
] satisfies readonly (MissCause | "none")[];

function isCause(value: string): value is MissCause | "none" {
	return CAUSES.includes(value);
}

function percent(locale: string, share: number): string {
	return formatShare(locale, share, 1) ?? "";
}

function rateParams(locale: string, rate: Rate | null) {
	if (!rate) return { share: "", low: "", high: "" };
	return {
		share: formatShare(locale, rate.k, rate.n) ?? "",
		low: percent(locale, rate.low),
		high: percent(locale, rate.high),
	};
}

function money(locale: string, value: number | null | undefined): string {
	return formatCost(locale, value ?? 0);
}

function tokens(locale: string, value: number | null | undefined): string {
	return formatTokens(locale, value ?? 0);
}

function ratio(locale: string, value: number | null): string {
	return value === null
		? ""
		: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

/** The interpolation values of a finding's title and explanation. */
function findingParams(
	t: Translator,
	finding: Finding,
	result: FindingsListResult,
): Record<string, string | number> {
	const locale = localeOf(t);
	const rule = result.rules;
	const exits = finding.shares
		.map((share) =>
			t("sessionInsights.findings.exitCount", { code: share.key, count: share.count }),
		)
		.join(", ");
	const causes = finding.shares
		.map((share) =>
			t("sessionInsights.findings.causeCount", {
				cause: isCause(share.key) ? t(MISS_CAUSE_LABEL[share.key]) : share.key,
				count: formatCount(locale, share.count),
			}),
		)
		.join(", ");
	const amount = (value: number | undefined) =>
		finding.rule === "tokenOutlier" ? tokens(locale, value) : money(locale, value);
	const list = finding.links
		.slice(0, LINKS_SHOWN)
		.map((link) => amount(link.value))
		.join(", ");
	const names = finding.shares
		.map((share) =>
			t("sessionInsights.findings.nameCount", { name: share.key, count: share.count }),
		)
		.join(", ");
	const meaning = finding.names[0];
	const windowValue = finding.figures.window?.value;
	return {
		inSessions: t("sessionInsights.findings.inSessions", { count: finding.sessions.length }),
		windowNote:
			windowValue === undefined || windowValue === null
				? ""
				: t("sessionInsights.findings.windowNote", { window: tokens(locale, windowValue) }),
		projectNote: finding.names[0]
			? t("sessionInsights.findings.projectNote", { project: finding.names[0] })
			: "",
		reworkThreshold: rule.reworkChanges,
		count: finding.count,
		countText: formatCount(locale, finding.count),
		total: formatCount(locale, finding.total ?? 0),
		subject: finding.subject ?? "",
		sessions: finding.sessions.length,
		exits: exits || t("sessionInsights.findings.noExit"),
		causes,
		...rateParams(locale, finding.rate),
		perRequest: tokens(locale, finding.figures.perRequest?.value),
		peak: tokens(locale, finding.figures.peak?.value),
		window: finding.figures.window ? tokens(locale, finding.figures.window.value) : "",
		rewritten: tokens(locale, finding.figures.rewritten?.value),
		median: amount(finding.figures.median?.value ?? undefined),
		largest: amount(finding.figures.largest?.value ?? undefined),
		ratio: ratio(locale, finding.ratio),
		list,
		outside: money(locale, finding.figures.outside?.value),
		recorded: money(locale, finding.figures.recorded?.value),
		outsideShare:
			finding.figures.recorded?.value && finding.figures.outside?.value !== undefined
				? (formatShare(
						locale,
						finding.figures.outside.value ?? 0,
						finding.figures.recorded.value,
					) ?? "")
				: "",
		largestOutput: formatCount(locale, finding.figures.largestOutput?.value ?? 0),
		limit: formatCount(locale, rule.oversizedChars),
		longest: ratio(locale, finding.ratio),
		threshold: rule.loopCalls,
		names,
		project: finding.names[0] ?? "",
		reads: formatCount(locale, finding.total ?? 0),
		meaning: meaning && isMeaning(meaning) ? t(EXIT_MEANING[meaning]) : "",
		code: finding.shares[0]?.key ?? "",
		share: rateParams(locale, finding.rate).share,
	};
}

function pillFigure(finding: Finding, text: string): FigureView[] {
	const first = Object.values(finding.figures)[0];
	return [
		{
			metric: "finding",
			origin: finding.heuristic ? "approximated" : (first?.origin ?? "counted"),
			exact: text,
		},
	];
}

/** The rate on a 0–50 % scale (wider when the interval reaches past it), its interval and the rule's threshold. */
function RateBar({
	rate,
	threshold,
	testId,
}: {
	rate: Rate;
	threshold: number | null;
	testId: string;
}) {
	const t = useT();
	const locale = localeOf(t);
	const max = Math.max(0.5, Math.ceil(rate.high * 10) / 10);
	const x = (share: number) => (Math.min(share, max) / max) * 100;
	const point = rate.n > 0 ? rate.k / rate.n : 0;
	return (
		<div data-testid={testId} className="flex items-center gap-8 tr-text-metadata text-text-subtle">
			<svg
				aria-hidden="true"
				viewBox="0 0 100 8"
				preserveAspectRatio="none"
				className="h-8 w-160 shrink-0 rounded-sm bg-control-bg"
			>
				<rect
					x={x(rate.low)}
					y={1}
					width={Math.max(0.8, x(rate.high) - x(rate.low))}
					height={6}
					className="fill-feedback-error-muted"
				/>
				<rect x={x(point) - 0.6} y={0} width={1.2} height={8} className="fill-feedback-error" />
				{threshold !== null ? (
					<rect
						x={x(threshold) - 0.4}
						y={0}
						width={0.8}
						height={8}
						className="fill-feedback-warning"
					/>
				) : null}
			</svg>
			<span className="tabular-nums">
				{t("sessionInsights.findings.rateScale", { max: percent(locale, max) })}
			</span>
			{threshold !== null ? (
				<span className="tabular-nums">
					{t("sessionInsights.findings.rateThreshold", { threshold: percent(locale, threshold) })}
				</span>
			) : null}
		</div>
	);
}

/** Diff segments keyed by where they start in the joined text: stable without an index key. */
function keyedSegments(segments: readonly DiffSegment[]): (DiffSegment & { key: string })[] {
	const out: (DiffSegment & { key: string })[] = [];
	let offset = 0;
	for (const segment of segments) {
		out.push({ ...segment, key: `${segment.op}:${offset}` });
		offset += segment.text.length;
	}
	return out;
}

function DiffText({ segments }: { segments: readonly DiffSegment[] }) {
	const keyed = keyedSegments(segments);
	return (
		<code className="min-w-0 whitespace-pre-wrap break-all tr-code-text-small text-text-default">
			{keyed.map((segment) => (
				<span
					key={segment.key}
					data-op={segment.op}
					className={cn(
						segment.op === "added" && "rounded-sm bg-feedback-success-subtle text-feedback-success",
						segment.op === "removed" &&
							"rounded-sm bg-feedback-error-subtle text-feedback-error line-through",
					)}
				>
					{segment.text}
				</span>
			))}
		</code>
	);
}

function FindingCard({
	finding,
	result,
	onShowSessions,
	onOpenSession,
	onHide,
}: {
	finding: Finding;
	result: FindingsListResult;
	onShowSessions: (label: string, ids: readonly string[]) => void;
	onOpenSession: (session: SessionRef, eventId: string | null) => void;
	onHide: (id: string, hidden: boolean) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const Icon = RULE_ICON[finding.rule];
	const params = findingParams(t, finding, result);
	const title = t(RULE_TITLE[finding.rule], params);
	const template = RULE_TEMPLATE[finding.rule];
	const meaning = finding.rule === "falseError" ? finding.names[0] : undefined;
	const known =
		finding.rule === "commandFailing"
			? result.exits.filter(
					(exit) =>
						exit.head === finding.subject &&
						finding.shares.some((share) => share.key === exit.exit),
				)
			: [];
	const refs = finding.sessions.flatMap((index) => {
		const ref = result.sessions[index];
		return ref ? [ref] : [];
	});
	const pill =
		finding.total !== null && (finding.rule === "commandFailing" || finding.rule === "poorRecovery")
			? t("sessionInsights.findings.pillOf", {
					count: formatCount(locale, finding.count),
					total: formatCount(locale, finding.total),
				})
			: formatCount(locale, finding.count);
	return (
		<li
			data-testid="finding-card"
			data-id={finding.id}
			data-rule={finding.rule}
			data-severity={finding.severity}
			data-hidden={finding.hidden}
			className={cn(
				"grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-8 border-border-muted border-b px-12 py-8",
				finding.hidden && "opacity-70",
			)}
		>
			<Icon aria-hidden className={cn("mt-2 size-16", SEVERITY_TONE[finding.severity])} />
			<div className="flex min-w-0 flex-col gap-4">
				<div className="flex min-w-0 flex-wrap items-center gap-6">
					<h4 className="min-w-0 tr-title-card text-text-default">{title}</h4>
					<span className="sr-only">{t(SEVERITY_LABEL[finding.severity])}</span>
					{finding.heuristic ? (
						<Pill
							testId="finding-heuristic"
							className="border-feedback-warning-muted text-feedback-warning"
						>
							{t("sessionInsights.findings.heuristic")}
						</Pill>
					) : null}
				</div>
				<p data-testid="finding-why" className="tr-text-ui text-text-muted">
					{t(RULE_WHY[finding.rule], {
						...params,
						count: WHY_COUNTS_TOTAL.has(finding.rule) ? (finding.total ?? 0) : finding.count,
					})}
					{known.map((exit) => (
						<span key={exit.exit}>
							{" "}
							{t("sessionInsights.findings.knownExit", {
								code: exit.exit,
								command: exit.head,
								meaning: t(EXIT_MEANING[exit.meaning]),
								count: finding.shares.find((share) => share.key === exit.exit)?.count ?? 0,
								total: finding.count,
							})}
						</span>
					))}
				</p>
				{finding.rule === "skillNeverLoaded" || finding.rule === "skillUnlisted" ? (
					<ul className="flex flex-wrap gap-4" aria-label={t("sessionInsights.findings.skills")}>
						{finding.names.map((name) => (
							<li
								key={name}
								data-testid="finding-name"
								className="rounded-sm border border-border-default px-4 tr-code-text-small text-text-default"
							>
								{name}
							</li>
						))}
					</ul>
				) : null}
				{finding.rate && (finding.rule === "commandFailing" || finding.rule === "poorRecovery") ? (
					<RateBar
						rate={finding.rate}
						threshold={finding.rule === "commandFailing" ? result.rules.failingShare : null}
						testId="finding-rate"
					/>
				) : null}
				{finding.quote ? (
					<p
						data-testid="finding-quote"
						className="flex min-w-0 flex-wrap items-baseline gap-6 tr-text-metadata text-text-subtle"
					>
						<code className="min-w-0 break-all rounded-sm bg-feedback-error-subtle px-4 tr-code-text-small text-feedback-error">
							{finding.quote.text}
						</code>
						<span>
							{t("sessionInsights.findings.quoteCount", {
								count: finding.count,
								quoted: formatCount(locale, finding.quote.count),
								total: formatCount(locale, finding.count),
							})}
						</span>
					</p>
				) : null}
				{finding.worked ? (
					<div
						data-testid="finding-worked"
						className="flex min-w-0 flex-col gap-2 rounded-md border border-border-default px-8 py-4"
					>
						<span className="tr-text-metadata text-text-subtle">
							{t("sessionInsights.findings.worked")}
						</span>
						<DiffText segments={finding.worked.segments} />
					</div>
				) : null}
				{finding.links.length > 0 ? (
					<div className="flex min-w-0 flex-wrap items-center gap-4 tr-text-metadata">
						<span className="text-text-subtle">{t("sessionInsights.findings.sessions")}</span>
						{finding.links.slice(0, LINKS_SHOWN).map((link) => {
							const ref = result.sessions[link.session];
							if (!ref) return null;
							const name = sessionName(t, ref);
							return (
								<Button
									key={link.session}
									variant="outline"
									size="s"
									data-testid="finding-session"
									data-session-id={ref.sessionId}
									className="max-w-240"
									tooltip={
										link.events.length > 0
											? t("sessionInsights.findings.openAtCall", { session: name })
											: t("sessionInsights.findings.openSession", { session: name })
									}
									onClick={() => onOpenSession(ref, link.events[0] ?? null)}
								>
									<span className="truncate">
										{link.count > 1
											? t("sessionInsights.findings.sessionTimes", { name, count: link.count })
											: name}
									</span>
								</Button>
							);
						})}
						{finding.links.length > LINKS_SHOWN ||
						finding.sessions.length > finding.links.length ? (
							<span className="text-text-subtle">
								{t("sessionInsights.findings.moreSessions", {
									count: finding.sessions.length - Math.min(LINKS_SHOWN, finding.links.length),
								})}
							</span>
						) : null}
					</div>
				) : null}
				<p className="tr-text-metadata text-text-subtle">
					<span className="text-text-muted">{t("sessionInsights.findings.whatToDo")}</span>{" "}
					{t(RULE_ACTION[finding.rule], params)} {t("sessionInsights.findings.notApplied")}
				</p>
				{template || meaning ? (
					<div
						data-testid="finding-template"
						className="flex min-w-0 flex-col gap-2 rounded-md border border-border-muted border-dashed px-8 py-4"
					>
						<span className="tr-text-metadata text-text-subtle">
							{t("sessionInsights.findings.template")}
						</span>
						<code className="whitespace-pre-wrap break-all tr-code-text-small text-text-muted">
							{meaning && isMeaning(meaning)
								? t(EXIT_TEMPLATE[meaning], params)
								: template
									? t(template, params)
									: ""}
						</code>
					</div>
				) : null}
			</div>
			<div className="flex flex-col items-end gap-4">
				<IconTooltip
					label={<FigureDetails figures={pillFigure(finding, pill)} sources={result.sources} />}
					align="end"
				>
					<button
						type="button"
						data-testid="finding-count"
						className={cn(
							"rounded-full border px-6 tr-text-caption tabular-nums focus-visible:focus-ring",
							SEVERITY_PILL[finding.severity],
						)}
					>
						{pill}
					</button>
				</IconTooltip>
				<Button
					variant="outline"
					size="s"
					iconLeft={RiFilter3Line}
					data-testid="finding-show-sessions"
					disabled={refs.length === 0}
					onClick={() =>
						onShowSessions(
							title,
							refs.map((ref) => ref.sessionId),
						)
					}
				>
					{t("sessionInsights.findings.showSessions")}
				</Button>
				<Button
					variant="ghost"
					size="s"
					iconLeft={finding.hidden ? RiEyeLine : RiEyeOffLine}
					data-testid="finding-hide"
					onClick={() => onHide(finding.id, !finding.hidden)}
				>
					{finding.hidden
						? t("sessionInsights.findings.unhide")
						: t("sessionInsights.findings.hide")}
				</Button>
			</div>
		</li>
	);
}

/**
 * The "what to do" findings as evidence cards in four groups. Every card is a deterministic rule over
 * the sessions' facts; nothing is applied. Hidden cards stay out until *Show hidden*.
 */
export function FindingsView({
	result,
	onShowSessions,
	onOpenSession,
	onHide,
}: {
	result: FindingsListResult;
	onShowSessions: (label: string, ids: readonly string[]) => void;
	onOpenSession: (session: SessionRef, eventId: string | null) => void;
	onHide: (id: string, hidden: boolean) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [showHidden, setShowHidden] = useState(false);
	const hidden = result.findings.filter((finding) => finding.hidden).length;
	const visible = result.findings.filter((finding) => showHidden || !finding.hidden);
	return (
		<div data-testid="findings-view" className="flex min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-8 border-border-default border-b px-12 py-4 tr-text-metadata text-text-muted">
				<span>{t("sessionInsights.findings.lead")}</span>
				<span className="ml-auto flex items-center gap-4">
					{SEVERITIES.map((severity) => {
						const count = result.findings.filter(
							(finding) => finding.severity === severity && !finding.hidden,
						).length;
						return (
							<span
								key={severity}
								data-testid={`findings-count-${severity}`}
								className={cn(
									"rounded-full border px-6 tr-text-caption tabular-nums",
									SEVERITY_PILL[severity],
								)}
							>
								{t("sessionInsights.findings.severityCount", {
									label: t(SEVERITY_LABEL[severity]),
									count: formatCount(locale, count),
								})}
							</span>
						);
					})}
					{hidden > 0 ? (
						<Button
							variant="ghost"
							size="s"
							data-testid="findings-show-hidden"
							aria-pressed={showHidden}
							selected={showHidden}
							onClick={() => setShowHidden(!showHidden)}
						>
							{t("sessionInsights.findings.showHidden", { count: hidden })}
						</Button>
					) : null}
				</span>
			</div>
			{visible.length === 0 ? (
				<p data-testid="findings-empty" className="p-16 text-center tr-text-ui text-text-muted">
					{t("sessionInsights.findings.empty")}
				</p>
			) : (
				GROUPS.map((group) => {
					const cards = visible.filter((finding) => finding.group === group);
					if (cards.length === 0) return null;
					return (
						<section key={group} data-testid="findings-group" data-group={group}>
							<h3 className="flex items-baseline gap-8 bg-control-bg px-12 py-4">
								<span className="tr-title-section text-text-default">{t(GROUP_LABEL[group])}</span>
								<span className="tr-text-metadata text-text-subtle">{t(GROUP_NOTE[group])}</span>
							</h3>
							<ul>
								{cards.map((finding) => (
									<FindingCard
										key={finding.id}
										finding={finding}
										result={result}
										onShowSessions={onShowSessions}
										onOpenSession={onOpenSession}
										onHide={onHide}
									/>
								))}
							</ul>
						</section>
					);
				})
			)}
		</div>
	);
}
