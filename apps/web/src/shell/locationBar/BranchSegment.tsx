import {
	RiArrowDownLine as ArrowDown,
	RiArrowUpLine as ArrowUp,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiGitBranchLine as GitBranch,
	RiGitPullRequestLine as PullRequest,
} from "@remixicon/react";
import type { OpenBranchReview, Workspace } from "@thinkrail/contracts";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useRef, useState } from "react";
import { copyText } from "../../lib";
import { BranchPicker } from "../../panels/BranchPicker";
import { useBranchList } from "../../panels/branches";
import { openReviewLabel } from "../../panels/useOpenBranchReview";
import { isUserOwnedWorkspace, selectDiffBaseRef, toast, useAppStore } from "../../store";
import { errorText, getTransport } from "../../transport";
import { pluralCommits, remoteCounts } from "./locationModel";
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

const rowActionClass =
	"flex size-24 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary";

export function BranchSegment({
	workspace,
	review,
}: {
	workspace: Workspace;
	review: OpenBranchReview | null;
}) {
	const [open, setOpen] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const diffBase = useAppStore((s) => selectDiffBaseRef(s, workspace.id));
	const { branches, refreshing, refresh } = useBranchList(open ? workspace.projectId : null);
	const userOwned = isUserOwnedWorkspace(workspace);
	const remote = remoteCounts(review);

	const copyBranch = () => {
		void copyText(workspace.branch).then((ok) => {
			if (ok) toast.success(`Copied ${workspace.branch}`);
			else toast.error("Couldn't write to the clipboard.");
		});
	};
	const pointDiffBaseAt = async (ref: string) => {
		try {
			await getTransport().request("workspace.setDiffBase", { id: workspace.id, ref });
		} catch (error) {
			toast.error(`Could not change the compare target: ${errorText(error)}`);
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Segment
				testid="scope-branch-segment"
				className="hidden max-w-[440px] shrink-[4] md:flex"
				caption={
					<>
						Branch
						{userOwned ? null : (
							<span className="truncate text-text-subtle tr-code-text-small leading-none">
								· from <span data-testid="scope-base">{workspace.baseBranch}</span>
							</span>
						)}
					</>
				}
			>
				<PopoverTrigger
					data-testid="scope-branch-trigger"
					aria-label={`Branch ${workspace.branch}`}
					className={pillClass}
				>
					<GitBranch aria-hidden="true" className="size-14 shrink-0" />
					<span data-testid="scope-branch" className="truncate tr-code-text">
						{workspace.branch}
					</span>
					<PillChevron />
				</PopoverTrigger>
			</Segment>
			{remote ? (
				<Segment testid="scope-remote-segment" caption="Remote" className="hidden shrink-0 md:flex">
					{remote.unpushed > 0 ? (
						<button
							type="button"
							data-testid="scope-remote-unpushed"
							className={chipClass("warning", true)}
							onClick={() => setOpen(true)}
						>
							<ArrowUp aria-hidden="true" />
							{remote.unpushed} to push
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
							{remote.behind} behind
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
					label="Branch"
					action={
						<IconTooltip label="Copy branch name">
							<button
								type="button"
								data-testid="scope-branch-copy"
								aria-label="Copy branch name"
								className={rowActionClass}
								onClick={copyBranch}
							>
								<Copy className="size-14" />
							</button>
						</IconTooltip>
					}
				>
					<span className="truncate tr-code-text">{workspace.branch}</span>
				</Row>
				{userOwned ? null : (
					<Row label="Based on">
						<span className="truncate tr-code-text">{workspace.baseBranch}</span>
					</Row>
				)}
				<Row label="Compare to">
					<BranchPicker
						branches={branches}
						selected={diffBase}
						refreshing={refreshing}
						label=""
						testid="scope-diff-base"
						triggerClassName="flex h-24 min-w-0 max-w-full items-center gap-4 rounded-[var(--radius-sm)] px-4 outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected"
						onSelect={(ref) => void pointDiffBaseAt(ref)}
						onRefresh={refresh}
					/>
				</Row>
				{review ? (
					<>
						<Row label="Remote">
							<span
								data-testid="scope-remote-summary"
								className={cn(
									remote ? "text-text-default" : "text-text-muted",
									"truncate tr-text-ui",
								)}
							>
								{remote
									? [
											remote.unpushed > 0 ? `${pluralCommits(remote.unpushed)} to push` : null,
											remote.behind > 0 ? `${pluralCommits(remote.behind)} behind origin` : null,
										]
											.filter(Boolean)
											.join(" · ")
									: "In sync with origin"}
							</span>
						</Row>
						<Row
							label={review.kind === "pull-request" ? "Pull request" : "Merge request"}
							action={
								review.url ? (
									<IconTooltip label={`Open ${openReviewLabel(review)}`}>
										<a
											data-testid="scope-review-open"
											aria-label={`Open ${openReviewLabel(review)}`}
											href={review.url}
											target="_blank"
											rel="noreferrer"
											className={rowActionClass}
										>
											<ExternalLink className="size-14" />
										</a>
									</IconTooltip>
								) : null
							}
						>
							<PullRequest aria-hidden="true" className="size-14 shrink-0 text-feedback-success" />
							<span className="truncate">{openReviewLabel(review)} · Open</span>
						</Row>
					</>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

export function ReviewSegment({ review }: { review: OpenBranchReview }) {
	const label = openReviewLabel(review);
	const chip = (
		<>
			<span aria-hidden="true" className="size-6 shrink-0 rounded-full bg-current" />
			{label}
			{review.url ? <ExternalLink aria-hidden="true" /> : null}
		</>
	);
	return (
		<Segment
			testid="scope-review-segment"
			caption={review.kind === "pull-request" ? "Pull request" : "Merge request"}
			className="hidden shrink-0 sm:flex"
		>
			{review.url ? (
				<a
					data-testid="scope-review"
					data-kind={review.kind}
					href={review.url}
					target="_blank"
					rel="noreferrer"
					aria-label={`Open ${label}`}
					className={chipClass("success", true)}
				>
					{chip}
				</a>
			) : (
				<span data-testid="scope-review" data-kind={review.kind} className={chipClass("success")}>
					{chip}
				</span>
			)}
		</Segment>
	);
}
