import {
	RiArrowDownLine as ArrowDown,
	RiArrowGoBackLine as ArrowGoBack,
	RiArrowUpLine as ArrowUp,
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiExternalLinkLine as ExternalLink,
	RiGitBranchLine as GitBranch,
	RiGitMergeLine as GitMerge,
	RiLoader4Line as Loader,
	RiGitPullRequestLine as PullRequest,
	RiRefreshLine as Refresh,
	type RemixiconComponentType,
	RiRobot2Line as Robot,
	RiSendPlaneLine as SendPlane,
	RiDeleteBin6Line as Trash2,
	RiUploadCloud2Line as UploadCloud,
} from "@remixicon/react";
import {
	type OpenBranchReview,
	REVIEW_ACTIONS_PROTOCOL_VERSION,
	type Workspace,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { cn } from "@thinkrail/ui/utils";
import type { BranchFacts } from "../../panels/branchStatusState";
import {
	type RemoteValue,
	type ShipAction,
	type ShipActionId,
	type ShipArm,
	shipActions,
} from "../../panels/shipActions";
import { type ShipRunner, useShipRunner } from "../../panels/useShipRunner";
import { canSettleWorkspace } from "../../panels/workspaceActions";
import { isDefaultWorkspace, selectWorkspaceChatTab, useAppStore } from "../../store";
import { ReviewChip, ReviewSegment } from "./BranchSegment";
import { chipClass, Segment, type SplitTone, splitFrameClass, splitPartClass } from "./Segment";

const ACTION_ICON: Record<ShipActionId, RemixiconComponentType> = {
	publish: UploadCloud,
	push: ArrowUp,
	sync: Refresh,
	openPr: PullRequest,
	openDraftPr: PullRequest,
	createMr: ExternalLink,
	mergeLocal: GitMerge,
	fixChecks: Robot,
	ready: SendPlane,
	mergePr: GitMerge,
	reopen: PullRequest,
	deleteRemote: GitBranch,
	settle: Check,
	keepActive: ArrowGoBack,
	remove: Trash2,
};

function splitTone(action: ShipAction | null): SplitTone {
	return action?.tone === "warning" ? "warning" : action ? "primary" : "neutral";
}

function ArmButton({
	arm,
	testid,
	pending,
	disabled,
	onRun,
}: {
	arm: ShipArm;
	testid: string;
	pending: ShipActionId | null;
	disabled: boolean;
	onRun: (id: ShipActionId) => void;
}) {
	const t = useT();
	const { primary, secondary } = arm;
	if (!primary && secondary.length === 0) return null;
	const tone = splitTone(primary);
	const Icon = primary ? ACTION_ICON[primary.id] : null;
	return (
		<span data-testid={testid} className={splitFrameClass(tone)}>
			{primary && Icon ? (
				<button
					type="button"
					data-testid={`${testid}-primary`}
					data-action={primary.id}
					aria-label={primary.label}
					disabled={disabled}
					onClick={() => onRun(primary.id)}
					className={cn(splitPartClass(tone), "px-8 tr-text-emphasis")}
				>
					{pending === primary.id ? <Loader className="animate-spin" /> : <Icon />}
					<span className="hidden md:inline">{primary.short}</span>
				</button>
			) : null}
			{secondary.length > 0 ? (
				<DropdownMenu>
					<DropdownMenuTrigger
						data-testid={`${testid}-menu`}
						aria-label={t("shell.location.ship.moreActions")}
						disabled={disabled}
						className={cn(
							splitPartClass(tone),
							primary ? "border-l border-current/20 px-2" : "px-4",
						)}
					>
						<ChevronDown />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" data-testid={`${testid}-menu-content`}>
						{secondary.map((action, index) => {
							const ItemIcon = ACTION_ICON[action.id];
							const danger = action.tone === "danger";
							const afterDanger = secondary[index - 1]?.tone === "danger";
							return (
								<div key={action.id}>
									{danger && index > 0 && !afterDanger ? <DropdownMenuSeparator /> : null}
									<DropdownMenuItem
										data-testid="scope-ship-action"
										data-action={action.id}
										disabled={action.disabled === true}
										onSelect={() => onRun(action.id)}
										className={cn(
											danger &&
												"text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error",
										)}
									>
										<ItemIcon />
										<span className="flex flex-col">
											<span>{action.label}</span>
											{action.hint ? (
												<span className="tr-text-metadata text-text-subtle">{action.hint}</span>
											) : null}
										</span>
									</DropdownMenuItem>
								</div>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</span>
	);
}

const valueText = "flex h-20 items-center gap-4 px-8 tr-text-ui";

function RemoteValueView({ value }: { value: RemoteValue }) {
	const t = useT();
	switch (value.kind) {
		case "noOrigin":
			return (
				<span className={cn(valueText, "text-text-subtle")}>
					{t("shell.location.remote.noRemote")}
				</span>
			);
		case "unreachable":
			return (
				<span className={cn(valueText, "text-text-subtle")}>
					{t("shell.location.remote.unreachable")}
				</span>
			);
		case "unpublished":
			return (
				<span className={cn(valueText, "text-text-muted")}>
					{t("shell.location.remote.notPublished")}
				</span>
			);
		case "published":
			return (
				<span className={cn(valueText, "text-text-muted")}>
					{t("shell.location.remote.published")}
				</span>
			);
		case "inSync":
			return (
				<span className={cn(valueText, "text-text-muted")}>
					<Check aria-hidden="true" className="size-14 text-feedback-success" />
					{t("shell.location.remote.inSyncShort")}
				</span>
			);
		case "counts":
			return (
				<>
					{value.ahead > 0 ? (
						<span data-testid="scope-remote-unpushed" className={chipClass("warning")}>
							<ArrowUp aria-hidden="true" />
							{value.ahead}
						</span>
					) : null}
					{value.behind > 0 ? (
						<span data-testid="scope-remote-behind" className={chipClass("info")}>
							<ArrowDown aria-hidden="true" />
							{value.behind}
						</span>
					) : null}
				</>
			);
	}
}

function ShipSegments({
	workspace,
	status,
	review,
	settled,
	runner,
}: {
	workspace: Workspace;
	status: BranchFacts;
	review: OpenBranchReview | null;
	settled: boolean;
	runner: ShipRunner;
}) {
	const t = useT();
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const model = shipActions(t, {
		status,
		review,
		base: workspace.baseBranch.replace(/^origin\//, ""),
		canSettle: canSettleWorkspace(protocolVersion, workspace),
		settled,
		removable: !isDefaultWorkspace(workspace),
		reviewActions: protocolVersion !== null && protocolVersion >= REVIEW_ACTIONS_PROTOCOL_VERSION,
	});
	const remoteAction = model.remote.primary;
	const showRemoteValue = !remoteAction || remoteAction.id === "sync";
	const caption =
		model.noun === "MR"
			? t("shell.location.review.mergeRequest")
			: t("shell.location.review.pullRequest");
	return (
		<>
			<Segment
				testid="scope-remote-segment"
				caption={t("shell.location.remote.caption")}
				className={cn("shrink-0", remoteAction ? "flex" : "hidden md:flex")}
			>
				{showRemoteValue ? (
					<span
						data-testid="scope-remote-value"
						data-kind={model.remote.value.kind}
						className="flex items-center gap-4"
					>
						<RemoteValueView value={model.remote.value} />
					</span>
				) : null}
				<ArmButton
					arm={model.remote}
					testid="scope-ship-remote"
					pending={runner.pending}
					disabled={runner.busy}
					onRun={runner.run}
				/>
			</Segment>
			<Segment
				testid="scope-review-segment"
				caption={caption}
				className={cn("shrink-0", review || model.review.primary ? "flex" : "hidden sm:flex")}
			>
				{review ? (
					<ReviewChip review={review} />
				) : model.review.primary ? null : (
					<span
						data-testid="scope-review-value"
						data-kind={model.review.value}
						className={cn(valueText, "text-text-subtle")}
					>
						{model.review.value === "base"
							? "—"
							: t("shell.location.ship.noReview", { noun: model.noun })}
					</span>
				)}
				<ArmButton
					arm={model.review}
					testid="scope-ship-review"
					pending={runner.pending}
					disabled={runner.busy}
					onRun={runner.run}
				/>
			</Segment>
		</>
	);
}

export function ShipStrip({
	workspace,
	status,
	review,
	settled,
	noteOpenReview,
	refresh,
}: {
	workspace: Workspace;
	status: BranchFacts | null;
	review: OpenBranchReview | null;
	settled: boolean;
	noteOpenReview: (review: OpenBranchReview, url?: string) => void;
	refresh: () => void;
}) {
	const sessionId = useAppStore((s) => selectWorkspaceChatTab(s, workspace.id)?.sessionId ?? null);
	const runner = useShipRunner({
		workspace,
		sessionId,
		openReview: null,
		review,
		status,
		noteOpenReview,
		refresh,
	});
	return (
		<>
			{status ? (
				<ShipSegments
					workspace={workspace}
					status={status}
					review={review}
					settled={settled}
					runner={runner}
				/>
			) : review ? (
				<ReviewSegment review={review} />
			) : null}
			{runner.dialogs}
		</>
	);
}
