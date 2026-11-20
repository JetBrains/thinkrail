import { RiChatCheckLine, RiGitPullRequestLine, RiShieldCheckLine } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import {
	type AttemptReview,
	type Card,
	canReview,
	durationText,
	latestReview,
	loadPacket,
	openEvidence,
	type Packet,
	packetPr,
	packetToPr,
	type ReviewItem,
	reviewCard,
	type Tally,
	tallyOf,
	type Verdict,
} from "./api";
import { Section } from "./Fields";
import { useHostQuery } from "./useHostQuery";

const VERDICT_LOOKS: Readonly<Record<Verdict, string>> = {
	met: "bg-feedback-success-subtle text-feedback-success",
	unmet: "bg-feedback-error-subtle text-feedback-error",
	untested: "bg-feedback-warning-subtle text-feedback-warning",
};

const VERDICT_LABELS = {
	met: "board.review.verdict.met",
	unmet: "board.review.verdict.unmet",
	untested: "board.review.verdict.untested",
} as const;

const SOURCE_LABELS = {
	criterion: "board.review.source.criterion",
	"task-spec": "board.review.source.taskSpec",
	openspec: "board.review.source.openspec",
} as const;

export function VerdictChip({ verdict }: { verdict: Verdict }) {
	const t = useT();
	return (
		<span
			data-testid="board-review-verdict"
			data-verdict={verdict}
			className={cn(
				"inline-flex shrink-0 items-center rounded-full px-8 py-2 tr-text-label-pill",
				VERDICT_LOOKS[verdict],
			)}
		>
			{t(VERDICT_LABELS[verdict])}
		</span>
	);
}

function tallyTitle(t: Translator, tally: Tally): string {
	return t("board.review.tallyTitle", { ...tally });
}

/** The tile's chip once the latest attempt was reviewed: `7/8 met`, warning while anything is unmet. */
export function ConformanceChip({ card }: { card: Pick<Card, "attempts"> }) {
	const t = useT();
	const review = latestReview(card);
	if (!review || review.items.length === 0) return null;
	const tally = tallyOf(review);
	const verdict: Verdict = tally.unmet > 0 ? "unmet" : tally.untested > 0 ? "untested" : "met";
	return (
		<span
			data-testid="board-conformance"
			data-verdict={verdict}
			title={tallyTitle(t, tally)}
			className={cn(
				"inline-flex shrink-0 items-center gap-2 self-start rounded-full px-8 py-2 tr-text-label-pill",
				VERDICT_LOOKS[verdict],
			)}
		>
			<RiShieldCheckLine aria-hidden className="size-12" />
			{t("board.review.tally", { met: tally.met, total: tally.total })}
		</span>
	);
}

function ConformanceRow({
	host,
	workspaceId,
	item,
}: {
	host: PanelHost;
	workspaceId: string;
	item: ReviewItem;
}) {
	const t = useT();
	return (
		<tr data-testid="board-review-item" data-item-id={item.id} data-verdict={item.verdict}>
			<td className="py-4 pr-8 align-top">
				<span className="flex flex-col gap-2">
					<span className="tr-text-ui text-text-default wrap-anywhere whitespace-pre-line">
						{item.text}
					</span>
					<span className="tr-text-metadata text-text-subtle">{t(SOURCE_LABELS[item.source])}</span>
				</span>
			</td>
			<td className="py-4 pr-8 align-top">
				<VerdictChip verdict={item.verdict} />
			</td>
			<td className="py-4 pr-8 align-top">
				{item.evidence.length === 0 ? (
					<span className="tr-text-metadata text-text-subtle">{t("board.review.none")}</span>
				) : (
					<ul className="flex flex-col gap-2">
						{item.evidence.map((entry) => (
							<li key={`${entry.path}:${entry.line ?? ""}:${entry.note}`} className="flex flex-col">
								<button
									type="button"
									data-testid="board-review-evidence"
									title={
										entry.line
											? t("board.review.openAt", { path: entry.path, line: entry.line })
											: t("board.review.open", { path: entry.path })
									}
									onClick={() => openEvidence(host, workspaceId, entry)}
									className="self-start rounded-xs text-left tr-code-text-small text-text-default underline wrap-anywhere focus-visible:focus-ring"
								>
									{entry.line
										? t("board.review.location", { path: entry.path, line: entry.line })
										: entry.path}
								</button>
								{entry.note ? (
									<span className="tr-text-metadata text-text-muted wrap-anywhere">
										{entry.note}
									</span>
								) : null}
							</li>
						))}
					</ul>
				)}
			</td>
			<td className="py-4 align-top">
				{item.tests.length === 0 ? (
					<span className="tr-text-metadata text-text-subtle">{t("board.review.none")}</span>
				) : (
					<ul className="flex flex-col gap-2">
						{item.tests.map((test) => (
							<li key={test} className="tr-code-text-small text-text-muted wrap-anywhere">
								{test}
							</li>
						))}
					</ul>
				)}
			</td>
		</tr>
	);
}

function ConformanceTable({
	host,
	workspaceId,
	review,
}: {
	host: PanelHost;
	workspaceId: string;
	review: AttemptReview;
}) {
	const t = useT();
	const tally = tallyOf(review);
	return (
		<div className="flex flex-col gap-4">
			<span className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
				<span data-testid="board-review-tally" title={tallyTitle(t, tally)}>
					{t("board.review.tally", { met: tally.met, total: tally.total })}
				</span>
				<time dateTime={new Date(review.at).toISOString()}>
					{t("board.review.reviewedAt", { time: new Date(review.at).toLocaleString() })}
				</time>
			</span>
			{review.summary ? (
				<p className="tr-text-ui text-text-default wrap-anywhere">{review.summary}</p>
			) : null}
			<div className="overflow-x-auto">
				<table data-testid="board-review-table" className="w-full border-collapse text-left">
					<thead>
						<tr className="tr-text-eyebrow text-text-muted">
							<th className="pr-8 pb-4 font-normal">{t("board.review.col.requirement")}</th>
							<th className="pr-8 pb-4 font-normal">{t("board.review.col.verdict")}</th>
							<th className="pr-8 pb-4 font-normal">{t("board.review.col.evidence")}</th>
							<th className="pb-4 font-normal">{t("board.review.col.tests")}</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-border-default">
						{review.items.map((item) => (
							<ConformanceRow key={item.id} host={host} workspaceId={workspaceId} item={item} />
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function PacketBody({ packet }: { packet: Packet }) {
	const t = useT();
	const { initiative } = packet.why;
	return (
		<div data-testid="board-packet" className="flex flex-col gap-8">
			<div className="flex flex-col gap-2">
				<h4 className="tr-text-eyebrow text-text-muted">{t("board.review.packet.why")}</h4>
				{initiative ? (
					<p className="tr-text-ui text-text-default wrap-anywhere">
						{t("board.review.packet.outcome", { ...initiative })}
					</p>
				) : null}
				<p className="tr-text-ui text-text-default wrap-anywhere">
					{t("board.review.packet.goal", { goal: packet.why.goal })}
				</p>
			</div>
			<div className="flex flex-col gap-2">
				<h4 className="tr-text-eyebrow text-text-muted">{t("board.review.packet.what")}</h4>
				{packet.what.summary ? (
					<p className="tr-text-ui text-text-default wrap-anywhere whitespace-pre-line">
						{packet.what.summary}
					</p>
				) : null}
				{packet.what.steps.length === 0 ? (
					<span className="tr-text-metadata text-text-subtle">
						{t("board.review.packet.noPlan")}
					</span>
				) : (
					<ul className="flex flex-col gap-2">
						{packet.what.steps.map((step) => (
							<li
								key={`${step.title}\u0000${step.status}\u0000${step.summary ?? ""}`}
								data-testid="board-packet-step"
								data-status={step.status}
								className="tr-text-metadata text-text-muted wrap-anywhere"
							>
								<span className="text-text-default">{step.title}</span>
								{step.summary ? ` — ${step.summary}` : null}
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="flex flex-col gap-2">
				<h4 className="tr-text-eyebrow text-text-muted">{t("board.review.packet.verified")}</h4>
				{packet.verified.length === 0 ? (
					<span className="tr-text-metadata text-text-subtle">
						{t("board.review.packet.noVerification")}
					</span>
				) : (
					<ul className="flex flex-col gap-2">
						{packet.verified.map((step) => (
							<li
								key={`${step.title}:${step.verification}`}
								className="tr-text-metadata text-text-muted wrap-anywhere"
							>
								{t("board.review.packet.verification", { ...step })}
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="flex flex-col gap-2">
				<h4 className="tr-text-eyebrow text-text-muted">{t("board.review.packet.time")}</h4>
				<span className="tr-text-metadata text-text-muted">
					{t("board.review.packet.timeLine", {
						agent: durationText(packet.time.agentMs),
						waiting: durationText(packet.time.waitingMs),
					})}
				</span>
			</div>
		</div>
	);
}

function PacketSection({ host, card }: { host: PanelHost; card: Card }) {
	const t = useT();
	const review = latestReview(card);
	const packet = useHostQuery(`packet:${card.id}:${review?.at ?? 0}`, (signal) =>
		loadPacket(host, card.id, signal),
	);
	const pr = packetPr(card);
	const [adding, setAdding] = useState(false);
	const [outcome, setOutcome] = useState<{ error: boolean; text: string } | null>(null);
	const add = () => {
		setAdding(true);
		setOutcome(null);
		packetToPr(host, card.id)
			.then(
				(result) =>
					setOutcome({
						error: false,
						text: result.updated
							? t("board.review.packet.added", { number: result.pr })
							: t("board.review.packet.unchanged", { number: result.pr }),
					}),
				(error: unknown) =>
					setOutcome({
						error: true,
						text: error instanceof Error ? error.message : t("board.error.unknown"),
					}),
			)
			.finally(() => setAdding(false));
	};
	return (
		<Section title={t("board.review.packet.title")} testId="board-packet-section">
			{packet.state.kind === "loading" ? (
				<span className="tr-text-metadata text-text-subtle">
					{t("board.review.packet.loading")}
				</span>
			) : packet.state.kind === "error" ? (
				<span role="alert" className="tr-text-metadata text-feedback-error wrap-anywhere">
					{t("board.review.packet.error", { error: packet.state.message })}
				</span>
			) : (
				<PacketBody packet={packet.state.value} />
			)}
			<span className="flex flex-wrap items-center gap-8">
				<Button
					variant="outline"
					size="s"
					iconLeft={RiGitPullRequestLine}
					loading={adding}
					disabled={pr === null}
					data-testid="board-packet-to-pr"
					onClick={add}
				>
					{t("board.review.packet.addToPr")}
				</Button>
				{pr === null ? (
					<span className="tr-text-metadata text-text-subtle">{t("board.review.packet.noPr")}</span>
				) : null}
			</span>
			{outcome ? (
				<p
					role={outcome.error ? "alert" : "status"}
					data-testid="board-packet-outcome"
					className={
						outcome.error
							? "tr-text-metadata text-feedback-error wrap-anywhere"
							: "tr-text-metadata text-text-muted"
					}
				>
					{outcome.text}
				</p>
			) : null}
		</Section>
	);
}

/**
 * Smart review in the card's Peek: run it on the latest attempt, its conformance table with evidence
 * that opens at its line, the way to the Review comments its unmet items became, and the review packet
 * with Add to PR. The reviewer's verdict is advisory.
 */
export function SmartReviewSection({
	host,
	projectId,
	card,
	onChanged,
}: {
	host: PanelHost;
	projectId: string;
	card: Card;
	onChanged: () => void;
}) {
	const t = useT();
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const review = latestReview(card);
	const attempt = card.attempts.at(-1);
	const available = canReview(card);
	const running = starting || !!card.reviewing;
	const commented = !!review?.items.some((item) => item.commentId);
	const start = () => {
		setStarting(true);
		setError(null);
		reviewCard(host, card.id)
			.then(onChanged, (failure: unknown) =>
				setError(failure instanceof Error ? failure.message : t("board.error.unknown")),
			)
			.finally(() => setStarting(false));
	};
	return (
		<Section title={t("board.review.title")} testId="board-review-section">
			<p className="tr-text-metadata text-text-subtle">{t("board.review.hint")}</p>
			<span className="flex flex-wrap items-center gap-8">
				<Button
					variant="soft-primary"
					size="s"
					iconLeft={RiShieldCheckLine}
					loading={running}
					disabled={!available || running}
					data-testid="board-review-run"
					onClick={start}
				>
					{review ? t("board.review.rerun") : t("board.review.run")}
				</Button>
				{review && commented && attempt && card.live.at(-1)?.open ? (
					<Button
						variant="outline"
						size="s"
						iconLeft={RiChatCheckLine}
						data-testid="board-review-comments"
						onClick={() =>
							host.openWorkspace({
								workspaceId: attempt.workspaceId,
								projectId,
								reveal: "review",
							})
						}
					>
						{t("board.review.openComments")}
					</Button>
				) : null}
			</span>
			{running ? (
				<span
					role="status"
					data-testid="board-review-running"
					className="tr-text-metadata text-text-muted"
				>
					{t("board.review.running")}
				</span>
			) : null}
			{!available && !review ? (
				<span className="tr-text-metadata text-text-subtle">{t("board.review.unavailable")}</span>
			) : null}
			{error || card.reviewError ? (
				<p
					role="alert"
					data-testid="board-review-error"
					className="tr-text-metadata text-feedback-error wrap-anywhere"
				>
					{t("board.review.failed", { error: error ?? card.reviewError ?? "" })}
				</p>
			) : null}
			{review && attempt ? (
				<ConformanceTable host={host} workspaceId={attempt.workspaceId} review={review} />
			) : null}
			{attempt ? <PacketSection host={host} card={card} /> : null}
		</Section>
	);
}
