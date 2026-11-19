import {
	RiArrowRightUpLine as Open,
	RiAddLine as Plus,
	RiLogoutBoxRLine as Remove,
	RiSparkling2Line as Sparkling,
	RiStackLine as Stack,
	RiArrowLeftLine as StackArrow,
} from "@remixicon/react";
import type { ChatState, OpenBranchReview, Workspace } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { DiffStatBadge } from "@thinkrail/ui/diff-stat-badge";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { RunningIcon } from "@/components/RunningIcon";
import {
	type ContainerMemberOverview,
	type ContainerStackLine,
	selectContainerOverview,
	stackBranchName,
	useAppStore,
	workspaceName,
} from "../store";
import { getTransport } from "../transport";
import { leaveContainer, openContainerMember, openOrchestrator } from "./containerActions";

const CHAT_STATE_LABELS: Record<Exclude<ChatState, "idle">, MessageKey> = {
	needs_you: "containers.overview.chat.needsYou",
	working: "containers.overview.chat.working",
	failed: "containers.overview.chat.failed",
	interrupted: "containers.overview.chat.interrupted",
	finished: "containers.overview.chat.finished",
};

const REVIEW_STATE_LABELS: Record<NonNullable<OpenBranchReview["state"]>, MessageKey> = {
	open: "containers.overview.pr.open",
	merged: "containers.overview.pr.merged",
	closed: "containers.overview.pr.closed",
};

/** Open TODOs per member (`SessionSummary.openTodos` summed over its chats), re-read as its chats start or settle. */
function useOpenSteps(memberKey: string): Readonly<Record<string, number>> {
	const status = useAppStore((state) => state.status);
	const generation = useAppStore((state) => state.connectionGeneration);
	const activity = useAppStore((state) =>
		memberKey
			.split("\n")
			.map((id) =>
				Object.values(state.sessionStateByWorkspace[id] ?? {})
					.map(
						(record) =>
							`${record.state.runId ?? ""}:${record.state.completion?.completionId ?? ""}`,
					)
					.join(","),
			)
			.join("|"),
	);
	const [steps, setSteps] = useState<Readonly<Record<string, number>>>({});
	useEffect(() => {
		if (status !== "connected" || !memberKey) return;
		let current = true;
		const transport = getTransport();
		void Promise.all(
			memberKey.split("\n").map((workspaceId) =>
				transport
					.request("session.list", { workspaceId })
					.then((sessions) => [
						[workspaceId, sessions.reduce((sum, session) => sum + (session.openTodos ?? 0), 0)],
					])
					.catch(() => []),
			),
		).then((entries) => {
			if (current) setSteps(Object.fromEntries(entries.flat()));
		});
		return () => {
			current = false;
		};
	}, [activity, generation, memberKey, status]);
	return steps;
}

function ChatStateChip({ chat }: { chat: ChatState }) {
	const t = useT();
	if (chat === "idle") return null;
	return (
		<span
			data-testid="container-overview-chat"
			data-chat-state={chat}
			className={cn(
				"flex shrink-0 items-center gap-4 rounded-full px-8 tr-text-label-pill",
				chat === "needs_you"
					? "bg-feedback-warning-subtle text-feedback-warning"
					: chat === "failed"
						? "bg-feedback-error-subtle text-feedback-error"
						: "bg-control-bg-selected text-text-muted",
			)}
		>
			{chat === "working" ? <RunningIcon className="size-12 text-primary" /> : null}
			{t(CHAT_STATE_LABELS[chat])}
		</span>
	);
}

function ReviewChip({ review }: { review: OpenBranchReview }) {
	const t = useT();
	const state = review.state ?? "open";
	return (
		<span
			data-testid="container-overview-pr"
			data-pr-state={state}
			className={cn(
				"shrink-0 rounded-full border px-8 tr-text-label-pill",
				state === "merged"
					? "border-primary text-primary"
					: "border-border-default text-text-muted",
			)}
		>
			{t("containers.overview.pr.label", {
				number: review.number,
				state: t(REVIEW_STATE_LABELS[state]),
			})}
		</span>
	);
}

function MemberCard({
	member,
	active,
	openSteps,
	onOpen,
	onRemove,
}: {
	member: ContainerMemberOverview;
	active: boolean;
	openSteps: number | undefined;
	onOpen: () => void;
	onRemove: () => void;
}) {
	const t = useT();
	const { workspace, projectName, stackedOn, chat } = member;
	const name = workspaceName(t, workspace);
	const title = projectName
		? t("containers.overview.memberTitle", { project: projectName, name })
		: name;
	return (
		<li
			data-testid="container-overview-member"
			data-member-id={workspace.id}
			data-active={active || undefined}
			data-focus-row={workspace.id}
			className={cn(
				"flex flex-col gap-4 rounded-md border bg-container-elevated-bg p-8",
				active ? "border-primary" : "border-border-default",
			)}
		>
			<div className="flex min-w-0 items-center gap-4">
				<button
					type="button"
					data-testid="container-overview-member-open"
					data-focus-row-primary
					onClick={onOpen}
					className="min-w-0 truncate rounded-sm text-left tr-text-ui text-text-default hover:underline focus-visible:focus-ring"
				>
					{title}
				</button>
				<span className="flex-1" />
				<ChatStateChip chat={chat} />
				{workspace.review ? <ReviewChip review={workspace.review} /> : null}
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 tr-text-metadata text-text-muted">
				<span className="min-w-0 truncate tr-code-text">{workspace.branch}</span>
				<span data-testid="container-overview-base" className="min-w-0 truncate">
					{stackedOn
						? t("containers.overview.stackedOn", { name: workspaceName(t, stackedOn) })
						: t("containers.overview.fromBase", {
								base: stackBranchName(workspace.baseBranch),
							})}
				</span>
				{openSteps ? (
					<span data-testid="container-overview-steps">
						{t("containers.overview.openSteps", { count: openSteps })}
					</span>
				) : null}
				{workspace.diffStats ? (
					<DiffStatBadge added={workspace.diffStats.added} removed={workspace.diffStats.removed} />
				) : null}
				<span className="flex-1" />
				<IconButton
					size="s"
					icon={Open}
					label={t("containers.overview.enter", { name })}
					data-testid="container-overview-member-enter"
					onClick={onOpen}
				/>
				<IconButton
					size="s"
					icon={Remove}
					label={t("containers.overview.removeMember", { name })}
					data-testid="container-overview-member-remove"
					onClick={onRemove}
				/>
			</div>
		</li>
	);
}

function stackMemberLabel(workspace: Workspace, name: string): string {
	return workspace.review ? `#${workspace.review.number} ${name}` : name;
}

function StackLine({ line }: { line: ContainerStackLine }) {
	const t = useT();
	return (
		<p
			data-testid="container-overview-stack-line"
			className="flex min-w-0 flex-wrap items-center gap-x-4 tr-text-metadata"
		>
			<span className="tr-code-text text-text-muted">{line.base}</span>
			{line.members.map((member) => (
				<span key={member.id} className="flex min-w-0 items-center gap-4">
					<StackArrow aria-hidden className="size-12 shrink-0 text-text-subtle" />
					<span className="sr-only"> ← </span>
					<span className="truncate text-text-default">
						{stackMemberLabel(member, workspaceName(t, member))}
					</span>
				</span>
			))}
		</p>
	);
}

/** A container at a glance in Peek: a card per member, the PR stack, and the add / open / remove actions. */
export function ContainerOverview({
	containerId,
	workspaceId,
}: {
	containerId: string;
	workspaceId: string;
}) {
	const t = useT();
	const containers = useAppStore((state) => state.containers);
	const projects = useAppStore((state) => state.projects);
	const workspaces = useAppStore((state) => state.workspaces);
	const sessionStateByWorkspace = useAppStore((state) => state.sessionStateByWorkspace);
	const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
	const overview = useMemo(
		() =>
			selectContainerOverview(
				{ containers, projects, workspaces, sessionStateByWorkspace },
				containerId,
			),
		[containerId, containers, projects, sessionStateByWorkspace, workspaces],
	);
	const memberKey = overview?.members.map((member) => member.workspace.id).join("\n") ?? "";
	const openSteps = useOpenSteps(memberKey);
	if (!overview) {
		return (
			<div
				data-testid="container-overview"
				data-state="missing"
				className="flex h-full items-center justify-center p-16 text-center tr-text-ui text-text-subtle"
			>
				{t("containers.overview.missing")}
			</div>
		);
	}
	const { group, members, stacks } = overview;
	const { container, orchestrator } = group;
	return (
		<div
			data-testid="container-overview"
			data-container-id={container.id}
			className="flex h-full min-h-0 flex-col"
		>
			<div className="flex shrink-0 items-center gap-8 border-border-muted border-b px-12 py-8">
				<Stack aria-hidden className="size-16 shrink-0 text-text-muted" />
				<h2 className="min-w-0 truncate tr-title-section text-text-default">{container.name}</h2>
				<span className="shrink-0 tr-text-metadata text-text-muted">
					{t("containers.memberCount", { count: members.length })}
				</span>
				<span className="flex-1" />
				{orchestrator ? (
					<Button
						variant="ghost"
						size="s"
						iconLeft={Sparkling}
						data-testid="container-overview-orchestrator"
						onClick={() => openOrchestrator(container.id)}
					>
						{t("containers.overview.showOrchestrator")}
					</Button>
				) : null}
			</div>
			<QuietScrollArea data-focus-default className="min-h-0 flex-1" viewportClassName="p-12">
				<div className="flex flex-col gap-12">
					<ul
						aria-label={t("containers.overview.members")}
						data-focus-list={`container-overview:${container.id}`}
						className="flex flex-col gap-8"
					>
						{members.map((member) => (
							<MemberCard
								key={member.workspace.id}
								member={member}
								active={member.workspace.id === activeWorkspaceId}
								openSteps={openSteps[member.workspace.id]}
								onOpen={() => openContainerMember(workspaceId, member.workspace)}
								onRemove={() => leaveContainer(container.id, member.workspace.id)}
							/>
						))}
					</ul>
					<section
						data-testid="container-overview-stack"
						aria-label={t("containers.overview.stackTitle")}
						className="flex flex-col gap-4 rounded-md border border-border-default border-dashed p-8"
					>
						<h3 className="tr-text-eyebrow text-text-muted">
							{t("containers.overview.stackTitle")}
						</h3>
						{stacks.lines.map((line) => (
							<StackLine key={line.members[0]?.id ?? line.base} line={line} />
						))}
						{stacks.independent.length > 0 ? (
							<p
								data-testid="container-overview-independent"
								className="min-w-0 tr-text-metadata text-text-muted"
							>
								{t(
									stacks.lines.length > 0
										? "containers.overview.independent"
										: "containers.overview.allIndependent",
									{
										names: stacks.independent
											.map((member) => stackMemberLabel(member, workspaceName(t, member)))
											.join(", "),
									},
								)}
							</p>
						) : null}
					</section>
					<div>
						<Button
							variant="outline"
							size="m"
							iconLeft={Plus}
							data-testid="container-overview-add"
							onClick={() =>
								useAppStore
									.getState()
									.openContainerDialog({ kind: "addWorkspace", containerId: container.id })
							}
						>
							{t("containers.addWorkspace")}
						</Button>
					</div>
				</div>
			</QuietScrollArea>
		</div>
	);
}
