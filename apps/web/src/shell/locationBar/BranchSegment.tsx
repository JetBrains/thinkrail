import {
	RiArrowDownLine as ArrowDown,
	RiArrowUpLine as ArrowUp,
	RiCheckLine as Check,
	RiCloseCircleFill as CloseCircle,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiGitBranchLine as GitBranch,
	RiLoader4Line as Loader,
	RiGitPullRequestLine as PullRequest,
} from "@remixicon/react";
import type { OpenBranchReview, ReviewChecks, Workspace } from "@thinkrail/contracts";
import { T, type Translator, useT } from "@thinkrail/locales/react";
import { buttonVariants, IconButton } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useRef, useState } from "react";
import { copyText } from "../../lib";
import { BranchPicker } from "../../panels/BranchPicker";
import { useBranchList } from "../../panels/branches";
import type { BranchFacts } from "../../panels/branchStatusState";
import { isOpenBranchReview, openReviewLabel } from "../../panels/useBranchStatus";
import { isUserOwnedWorkspace, selectDiffBaseRef, toast, useAppStore } from "../../store";
import { errorText, getTransport } from "../../transport";
import {
	checksSummary,
	checksVerdict,
	remoteCounts,
	reviewChipLabel,
	reviewStateLabel,
	reviewSummary,
	reviewTone,
} from "./locationModel";
import { chipClass, PillChevron, pillClass, Segment } from "./Segment";

function Row({
	label,
	children,
	action,
}: {
	label: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="flex min-h-28 items-center gap-8 px-12">
			<span className="w-[88px] shrink-0 whitespace-nowrap text-text-subtle tr-text-metadata">
				{label}
			</span>
			<span className="flex min-w-0 flex-1 items-center gap-8 text-text-default tr-text-ui">
				{children}
			</span>
			{action}
		</div>
	);
}

interface RemoteSummary {
	text: string;
	diverges: boolean;
}

function countsSummary(t: Translator, ahead: number, behind: number): RemoteSummary {
	const parts = [
		ahead > 0 ? t("shell.location.remote.unpushedCommits", { count: ahead }) : null,
		behind > 0 ? t("shell.location.remote.behindCommits", { count: behind }) : null,
	].filter(Boolean);
	return parts.length > 0
		? { text: parts.join(" · "), diverges: true }
		: { text: t("shell.location.remote.inSync"), diverges: false };
}

function statusSummary(t: Translator, status: BranchFacts): RemoteSummary | null {
	if (!status.hasOrigin) return { text: t("shell.location.remote.noOrigin"), diverges: false };
	if (status.published === null)
		return { text: t("shell.location.remote.unreadable"), diverges: false };
	if (!status.published) return { text: t("shell.location.remote.notPublished"), diverges: false };
	if (status.ahead === undefined || status.behind === undefined) return null;
	return countsSummary(t, status.ahead, status.behind);
}

export function BranchSegment({
	workspace,
	review,
	reviewDetailsKnown,
	status,
}: {
	workspace: Workspace;
	review: OpenBranchReview | null;
	reviewDetailsKnown: boolean;
	status: BranchFacts | null;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const diffBase = useAppStore((s) => selectDiffBaseRef(s, workspace.id));
	const { branches, refreshing, refresh } = useBranchList(open ? workspace.projectId : null);
	const userOwned = isUserOwnedWorkspace(workspace);
	const remoteStatus = status ? null : remoteCounts(review, reviewDetailsKnown);
	const remote = remoteStatus === "unknown" ? null : remoteStatus;
	const openDetails = review && isOpenBranchReview(review) ? review.details : undefined;
	const decision = openDetails ? reviewSummary(t, openDetails) : null;
	const summary = status
		? statusSummary(t, status)
		: review && isOpenBranchReview(review) && remoteStatus !== "unknown"
			? countsSummary(t, remote?.unpushed ?? 0, remote?.behind ?? 0)
			: null;

	const copyBranch = () => {
		void copyText(workspace.branch).then((ok) => {
			if (ok) toast.success(t("shell.location.branch.copied", { branch: workspace.branch }));
			else toast.error(t("shell.location.branch.clipboardFailed"));
		});
	};
	const pointDiffBaseAt = async (ref: string) => {
		try {
			await getTransport().request("workspace.setDiffBase", { id: workspace.id, ref });
		} catch (error) {
			toast.error(t("shell.location.branch.compareFailed", { error: errorText(error) }));
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Segment
				testid="scope-branch-segment"
				className="hidden max-w-[440px] shrink-[4] md:flex"
				caption={
					<>
						{t("shell.location.branch.caption")}
						{userOwned ? null : (
							<span className="truncate">
								<T
									i18nKey="shell.location.branch.fromBase"
									values={{ base: workspace.baseBranch }}
									components={[<span key="base" data-testid="scope-base" />]}
								/>
							</span>
						)}
					</>
				}
			>
				<PopoverTrigger
					data-testid="scope-branch-trigger"
					aria-label={t("shell.location.branch.label", { branch: workspace.branch })}
					className={pillClass}
				>
					<GitBranch aria-hidden="true" className="size-14 shrink-0" />
					<span data-testid="scope-branch" className="truncate tr-title-section">
						{workspace.branch}
					</span>
					<PillChevron />
				</PopoverTrigger>
			</Segment>
			{remote ? (
				<Segment
					testid="scope-remote-segment"
					caption={t("shell.location.remote.caption")}
					className="hidden shrink-0 md:flex"
				>
					{remote.unpushed > 0 ? (
						<button
							type="button"
							data-testid="scope-remote-unpushed"
							className={chipClass("warning", true)}
							onClick={() => setOpen(true)}
						>
							<ArrowUp aria-hidden="true" />
							{t("shell.location.remote.unpushedChip", { count: remote.unpushed })}
						</button>
					) : null}
					{remote.behind > 0 ? (
						<button
							type="button"
							data-testid="scope-remote-behind"
							className={chipClass("info", true)}
							onClick={() => setOpen(true)}
						>
							<ArrowDown aria-hidden="true" />
							{t("shell.location.remote.behindChip", { count: remote.behind })}
						</button>
					) : null}
				</Segment>
			) : null}
			<PopoverContent
				align="start"
				data-testid="scope-branch-popover"
				className="flex w-[380px] flex-col py-8"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					contentRef.current?.focus();
				}}
				ref={contentRef}
			>
				<Row
					label={t("shell.location.branch.caption")}
					action={
						<IconButton
							variant="ghost"
							size="m"
							icon={Copy}
							label={t("shell.location.branch.copyName")}
							data-testid="scope-branch-copy"
							className="shrink-0"
							onClick={copyBranch}
						/>
					}
				>
					<span className="truncate tr-code-text">{workspace.branch}</span>
				</Row>
				{userOwned ? null : (
					<Row label={t("shell.location.branch.basedOn")}>
						<span className="truncate tr-code-text">{workspace.baseBranch}</span>
					</Row>
				)}
				<Row label={t("shell.location.branch.compareTo")}>
					<BranchPicker
						branches={branches}
						selected={diffBase}
						refreshing={refreshing}
						label=""
						testid="scope-diff-base"
						onSelect={(ref) => void pointDiffBaseAt(ref)}
						onRefresh={refresh}
					/>
				</Row>
				{summary ? (
					<Row label={t("shell.location.remote.caption")}>
						<span
							data-testid="scope-remote-summary"
							className={cn(
								summary.diverges ? "text-text-default" : "text-text-muted",
								"truncate tr-text-ui",
							)}
						>
							{summary.text}
						</span>
					</Row>
				) : null}
				{review ? (
					<Row
						label={
							review.kind === "pull-request"
								? t("shell.location.review.pullRequest")
								: t("shell.location.review.mergeRequest")
						}
						action={
							review.url ? (
								<IconTooltip
									label={t("shell.location.review.openLink", { label: openReviewLabel(review) })}
								>
									<a
										data-testid="scope-review-open"
										aria-label={t("shell.location.review.openLink", {
											label: openReviewLabel(review),
										})}
										href={review.url}
										target="_blank"
										rel="noreferrer"
										className={buttonVariants({
											variant: "ghost",
											size: "m",
											shape: "icon",
											className: "shrink-0",
										})}
									>
										<ExternalLink aria-hidden />
									</a>
								</IconTooltip>
							) : null
						}
					>
						<PullRequest
							aria-hidden="true"
							className={cn(
								"size-14 shrink-0",
								reviewTone(review) === "success"
									? "text-feedback-success"
									: reviewTone(review) === "info"
										? "text-feedback-info"
										: "text-text-muted",
							)}
						/>
						<span className="truncate" data-testid="scope-review-state">
							{t("shell.location.review.stateLine", {
								label: openReviewLabel(review),
								state: reviewStateLabel(t, review),
							})}
						</span>
					</Row>
				) : null}
				{openDetails?.checks ? (
					<Row label={t("shell.location.review.checksCaption")}>
						<ChecksGlyph checks={openDetails.checks} />
						<span data-testid="scope-review-checks" className="truncate">
							{checksSummary(t, openDetails.checks)}
						</span>
					</Row>
				) : null}
				{decision ? (
					<Row label={t("shell.location.review.decisionCaption")}>
						<span
							data-testid="scope-review-decision"
							data-tone={decision.tone}
							className={cn(
								"truncate",
								decision.tone === "success"
									? "text-feedback-success"
									: decision.tone === "warning"
										? "text-feedback-warning"
										: "text-text-muted",
							)}
						>
							{decision.text}
						</span>
					</Row>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

function ChecksGlyph({ checks }: { checks: ReviewChecks }) {
	switch (checksVerdict(checks)) {
		case "failing":
			return <CloseCircle aria-hidden="true" className="size-12 shrink-0 text-feedback-error" />;
		case "pending":
			return (
				<Loader aria-hidden="true" className="size-12 shrink-0 animate-spin text-text-muted" />
			);
		case "passing":
			return <Check aria-hidden="true" className="size-12 shrink-0 text-feedback-success" />;
	}
}

export function ReviewChip({ review }: { review: OpenBranchReview }) {
	const t = useT();
	const label = reviewChipLabel(t, review);
	const tone = reviewTone(review);
	const checks = isOpenBranchReview(review) ? review.details?.checks : undefined;
	const checksText = checks ? checksSummary(t, checks) : null;
	const chip = (
		<>
			<span aria-hidden="true" className="size-6 shrink-0 rounded-full bg-current" />
			{label}
			{checks ? (
				<span data-testid="scope-review-checks-glyph" data-verdict={checksVerdict(checks)}>
					<ChecksGlyph checks={checks} />
				</span>
			) : review.url ? (
				<ExternalLink aria-hidden="true" />
			) : null}
		</>
	);
	const described = checksText ? `${label} · ${checksText}` : label;
	const element = review.url ? (
		<a
			data-testid="scope-review"
			data-kind={review.kind}
			href={review.url}
			target="_blank"
			rel="noreferrer"
			aria-label={t("shell.location.review.openLink", { label: described })}
			data-state-tone={tone}
			className={chipClass(tone, true)}
		>
			{chip}
		</a>
	) : (
		<span
			data-testid="scope-review"
			data-kind={review.kind}
			data-state-tone={tone}
			className={chipClass(tone)}
		>
			{chip}
			{checksText ? <span className="sr-only">{checksText}</span> : null}
		</span>
	);
	return checksText ? <IconTooltip label={checksText}>{element}</IconTooltip> : element;
}

export function ReviewSegment({ review }: { review: OpenBranchReview }) {
	const t = useT();
	return (
		<Segment
			testid="scope-review-segment"
			caption={
				review.kind === "pull-request"
					? t("shell.location.review.pullRequest")
					: t("shell.location.review.mergeRequest")
			}
			className="hidden shrink-0 sm:flex"
		>
			<ReviewChip review={review} />
		</Segment>
	);
}
