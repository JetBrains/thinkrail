import {
	RiCheckLine as Check,
	RiCloseLine as Close,
	RiExternalLinkLine as ExternalLink,
	RiGitCommitLine as GitCommit,
	RiRefreshLine as Refresh,
	RiRobot2Line as Robot,
	RiSendPlaneLine as SendPlane,
	RiUploadCloud2Line as UploadCloud,
} from "@remixicon/react";
import type { PrBabysitItem, PrBabysitSessionState } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, type ButtonIcon } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { openChangesTab, openFileAtLine } from "../../panels/openTabs";
import { SegmentedControl } from "../../panels/SegmentedControl";
import { isOpenPrBabysitItem, selectPrBabysit, toast, useAppStore } from "../../store";
import { getTransport } from "../../transport";
import {
	PR_BABYSIT_SESSION_LABEL,
	PR_BABYSIT_SEVERITY_LABEL,
	PR_BABYSIT_SOURCE_LABEL,
	type PrBabysitItemActionId,
	prBabysitItemActions,
	prBabysitItemStatusLabel,
} from "./prBabysitLabels";

type DrawerTab = "findings" | "queue";
type DrawerFilter = "open" | "all";

const badge =
	"inline-flex h-20 shrink-0 items-center whitespace-nowrap rounded-full px-8 tr-text-metadata";

const SEVERITY_TONE: Record<NonNullable<PrBabysitItem["severity"]>, string> = {
	blocker: "bg-feedback-error-subtle text-feedback-error",
	warning: "bg-feedback-warning-subtle text-feedback-warning",
	suggestion: "bg-feedback-info-subtle text-feedback-info",
};

function statusTone(item: PrBabysitItem): string {
	switch (item.status) {
		case "working":
		case "queued":
			return "bg-primary-subtle text-primary";
		case "needs_human":
			return "bg-feedback-warning-subtle text-feedback-warning";
		case "pushed":
		case "resolved":
			return "bg-feedback-success-subtle text-feedback-success";
		default:
			return "bg-control-bg-selected text-text-muted";
	}
}

const ACTION_ICON: Record<PrBabysitItemActionId, ButtonIcon> = {
	fix: Robot,
	post: SendPlane,
	openDiff: GitCommit,
	approvePush: UploadCloud,
	retry: Refresh,
	dismiss: Close,
};

type ItemRequest = "prBabysit.queueFinding" | "prBabysit.postFinding" | "prBabysit.approvePush";

function ItemRow({
	workspaceId,
	item,
	pending,
	onAction,
}: {
	workspaceId: string;
	item: PrBabysitItem;
	pending: boolean;
	onAction: (item: PrBabysitItem, action: PrBabysitItemActionId) => void;
}) {
	const t = useT();
	const label: Record<PrBabysitItemActionId, string> = {
		fix: t("prBabysit.action.fix"),
		post: t("prBabysit.action.post"),
		openDiff: t("prBabysit.action.openDiff"),
		approvePush: t("prBabysit.action.approvePush"),
		retry: t("prBabysit.action.retry"),
		dismiss: t("prBabysit.action.dismiss"),
	};
	const location = item.path ? `${item.path}${item.line ? `:${item.line}` : ""}` : null;
	return (
		<li
			data-testid="babysit-item"
			data-item-status={item.status}
			data-item-source={item.source}
			className="flex flex-col gap-8 border-border-muted border-b py-12 last:border-b-0"
		>
			<div className="flex flex-wrap items-center gap-4">
				<span className={cn(badge, "bg-control-bg-selected text-text-muted")}>
					{t(PR_BABYSIT_SOURCE_LABEL[item.source])}
				</span>
				{item.severity ? (
					<span className={cn(badge, SEVERITY_TONE[item.severity])}>
						{t(PR_BABYSIT_SEVERITY_LABEL[item.severity])}
					</span>
				) : null}
				<span data-testid="babysit-item-status" className={cn(badge, statusTone(item))}>
					{prBabysitItemStatusLabel(t, item)}
				</span>
				{item.postedToGithub ? (
					<span className={cn(badge, "gap-4 text-text-muted")}>
						<Check aria-hidden className="size-12" />
						{t("prBabysit.item.posted")}
					</span>
				) : null}
			</div>
			{location ? (
				<button
					type="button"
					data-testid="babysit-item-location"
					className="self-start truncate rounded-sm tr-code-text text-primary hover:underline focus-visible:focus-ring"
					onClick={() =>
						item.path
							? void openFileAtLine(workspaceId, item.path, { line: item.line ?? 1 }, "keep")
							: undefined
					}
				>
					{location}
				</button>
			) : null}
			<p className="wrap-anywhere whitespace-pre-wrap tr-text-ui text-text-default">
				{item.summary}
			</p>
			{item.suggestedFix ? (
				<p className="wrap-anywhere tr-text-metadata text-text-muted">{item.suggestedFix}</p>
			) : null}
			{item.errorMessage ? (
				<p className="wrap-anywhere tr-text-metadata text-feedback-warning">{item.errorMessage}</p>
			) : null}
			<div className="flex flex-wrap items-center gap-8 text-text-subtle tr-text-metadata">
				{item.author ? <span>{t("prBabysit.item.author", { author: item.author })}</span> : null}
				{item.reviewerModel ? (
					<span>{t("prBabysit.item.reviewer", { model: item.reviewerModel })}</span>
				) : null}
				{item.detailsUrl ? (
					<a
						href={item.detailsUrl}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-4 rounded-sm text-primary hover:underline focus-visible:focus-ring"
					>
						<ExternalLink aria-hidden className="size-12" />
						{t("prBabysit.action.openOnGithub")}
					</a>
				) : null}
			</div>
			<div className="flex flex-wrap gap-8">
				{prBabysitItemActions(item).map((action) => (
					<Button
						key={action}
						data-testid={`babysit-action-${action}`}
						size="s"
						variant={
							action === "approvePush" || action === "fix"
								? "soft-primary"
								: action === "dismiss"
									? "ghost"
									: "outline"
						}
						iconLeft={ACTION_ICON[action]}
						disabled={pending}
						onClick={() => onAction(item, action)}
					>
						{label[action]}
					</Button>
				))}
			</div>
		</li>
	);
}

export function PrBabysitDrawer({
	workspaceId,
	prNumber,
	open,
	onOpenChange,
}: {
	workspaceId: string;
	prNumber: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const session: PrBabysitSessionState | null = useAppStore((s) => selectPrBabysit(s, workspaceId));
	const [tab, setTab] = useState<DrawerTab>("findings");
	const [filter, setFilter] = useState<DrawerFilter>("open");
	const [pendingItem, setPendingItem] = useState<string | null>(null);

	const install = (state: PrBabysitSessionState | null) =>
		useAppStore.getState().installPrBabysitState(workspaceId, state);

	const request = (method: ItemRequest, itemId: string) =>
		getTransport().request(method, { workspaceId, itemId });

	const run = (item: PrBabysitItem, action: PrBabysitItemActionId) => {
		if (action === "openDiff") {
			if (item.commitSha)
				void openChangesTab(
					workspaceId,
					{ kind: "commit", sha: item.commitSha },
					{ revealPath: item.path ?? null },
					"keep",
				);
			return;
		}
		const call =
			action === "fix"
				? request("prBabysit.queueFinding", item.itemId)
				: action === "post"
					? request("prBabysit.postFinding", item.itemId)
					: action === "approvePush"
						? request("prBabysit.approvePush", item.itemId)
						: getTransport().request("prBabysit.itemAction", {
								workspaceId,
								itemId: item.itemId,
								action: action === "retry" ? "retry" : "dismiss",
							});
		setPendingItem(item.itemId);
		call
			.then(install, () => toast.error(t("prBabysit.action.failed")))
			.finally(() => setPendingItem(null));
	};

	const items = (session?.items ?? [])
		.filter((item) =>
			tab === "findings"
				? item.source === "independent_review"
				: item.source !== "independent_review",
		)
		.filter((item) => filter === "all" || isOpenPrBabysitItem(item))
		.sort((a, b) => b.updatedAt - a.updatedAt);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-testid="babysit-drawer"
				className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-[36rem] translate-x-0 translate-y-0 gap-12 rounded-none border-0 border-l"
			>
				<DialogHeader>
					<DialogTitle>{t("prBabysit.drawer.title", { number: prNumber })}</DialogTitle>
					<DialogDescription>
						{t("prBabysit.drawer.description", {
							repo: session ? `${session.owner}/${session.repo}` : "",
						})}
					</DialogDescription>
				</DialogHeader>
				{session ? (
					<div className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
						<span data-testid="babysit-session-status" data-status={session.status}>
							{t(PR_BABYSIT_SESSION_LABEL[session.status])}
						</span>
						<span>
							{t("prBabysit.drawer.cycles", {
								count: session.cycleCount,
								max: session.config.maxPushCycles,
							})}
						</span>
						{session.error ? (
							<span className="wrap-anywhere text-feedback-warning">{session.error}</span>
						) : null}
					</div>
				) : (
					<p className="tr-text-ui text-text-muted">{t("prBabysit.drawer.notStarted")}</p>
				)}
				<div className="flex flex-wrap items-center justify-between gap-8">
					<SegmentedControl<DrawerTab>
						name="babysit-tab"
						label={t("prBabysit.drawer.tabs")}
						testId="babysit-tabs"
						value={tab}
						onSelect={setTab}
						options={[
							{
								id: "findings",
								label: t("prBabysit.drawer.tab.findings"),
								testId: "babysit-tab-findings",
							},
							{
								id: "queue",
								label: t("prBabysit.drawer.tab.queue"),
								testId: "babysit-tab-queue",
							},
						]}
					/>
					<SegmentedControl<DrawerFilter>
						name="babysit-filter"
						label={t("prBabysit.drawer.filter.label")}
						value={filter}
						onSelect={setFilter}
						options={[
							{ id: "open", label: t("prBabysit.drawer.filter.open") },
							{ id: "all", label: t("prBabysit.drawer.filter.all") },
						]}
					/>
				</div>
				{items.length === 0 ? (
					<p data-testid="babysit-empty" className="tr-text-ui text-text-muted">
						{tab === "findings"
							? t("prBabysit.drawer.emptyFindings")
							: t("prBabysit.drawer.emptyQueue")}
					</p>
				) : (
					<ul className="flex min-h-0 flex-col overflow-y-auto">
						{items.map((item) => (
							<ItemRow
								key={item.itemId}
								workspaceId={workspaceId}
								item={item}
								pending={pendingItem === item.itemId}
								onAction={run}
							/>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
