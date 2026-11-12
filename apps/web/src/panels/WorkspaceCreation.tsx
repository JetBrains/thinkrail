import {
	RiErrorWarningLine as ErrorWarning,
	RiLoader4Line as Loader,
	RiPencilLine as Pencil,
	RiRefreshLine as Refresh,
	RiCloseLine as X,
} from "@remixicon/react";
import type { WorkspaceCreation } from "@thinkrail/contracts";
import { type Translator, t as translate, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { useEffect } from "react";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { openChatInTab } from "./openChat";

const HOVER_CONTROL_CLASS =
	"shrink-0 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100";

function percentOf(creation: WorkspaceCreation): number | null {
	const progress = creation.progress;
	if (!progress || progress.total <= 0) return null;
	return Math.min(100, Math.floor((progress.done / progress.total) * 100));
}

function statusLabel(t: Translator, creation: WorkspaceCreation): string {
	const percent = percentOf(creation);
	if (creation.state === "failed") return t("panels.workspaceCreation.failed");
	if (creation.state === "interrupted")
		return percent === null
			? t("panels.workspaceCreation.interrupted")
			: t("panels.workspaceCreation.interruptedAt", { percent });
	return percent === null
		? t("panels.workspaceCreation.creating")
		: t("panels.workspaceCreation.creatingAt", { percent });
}

function statusReason(t: Translator, creation: WorkspaceCreation): string | null {
	if (creation.state === "failed") return creation.failure?.message ?? null;
	if (creation.state === "interrupted") return t("panels.workspaceCreation.interruptedReason");
	return null;
}

export function retryCreation(id: string): void {
	getTransport()
		.request("workspace.retryCreation", { id })
		.then((creation) => useAppStore.getState().applyWorkspaceCreation(creation))
		.catch((err: unknown) =>
			toast.error(errorText(err), translate("panels.workspaceCreation.retryFailed")),
		);
}

export function dismissCreation(id: string): void {
	getTransport()
		.request("workspace.dismissCreation", { id })
		.catch((err: unknown) =>
			toast.error(errorText(err), translate("panels.workspaceCreation.dismissFailed")),
		);
}

export function editAndRetryCreation(creation: WorkspaceCreation): void {
	getTransport()
		.request("workspace.dismissCreation", { id: creation.id })
		.then(({ kickoff }) =>
			useAppStore.getState().openWorkspaceRetry({
				projectId: creation.projectId,
				baseRef: creation.baseBranch,
				...(kickoff ? { kickoff } : {}),
			}),
		)
		.catch((err: unknown) =>
			toast.error(errorText(err), translate("panels.workspaceCreation.dismissFailed")),
		);
}

function CreationActions({
	creation,
	size,
}: {
	creation: WorkspaceCreation;
	size: "row" | "card";
}) {
	const t = useT();
	if (creation.state === "running") return null;
	const name = creation.name;
	if (size === "row") {
		return (
			<span className="flex shrink-0 items-center gap-4">
				<IconButton
					icon={Refresh}
					label={t("panels.workspaceCreation.retryLabel", { name })}
					tooltip={t("panels.workspaceCreation.retry")}
					variant="ghost"
					size="s"
					data-testid="workspace-creation-retry"
					onClick={() => retryCreation(creation.id)}
					className={HOVER_CONTROL_CLASS}
				/>
				{creation.state === "failed" ? (
					<IconButton
						icon={Pencil}
						label={t("panels.workspaceCreation.editRetryLabel", { name })}
						tooltip={t("panels.workspaceCreation.editRetry")}
						variant="ghost"
						size="s"
						data-testid="workspace-creation-edit-retry"
						onClick={() => editAndRetryCreation(creation)}
						className={HOVER_CONTROL_CLASS}
					/>
				) : null}
				<IconButton
					icon={X}
					label={
						creation.state === "failed"
							? t("panels.workspaceCreation.dismissLabel", { name })
							: t("panels.workspaceCreation.discardLabel", { name })
					}
					tooltip={
						creation.state === "failed"
							? t("panels.workspaceCreation.dismiss")
							: t("panels.workspaceCreation.discard")
					}
					variant="ghost"
					size="s"
					data-testid="workspace-creation-dismiss"
					onClick={() => dismissCreation(creation.id)}
					className={HOVER_CONTROL_CLASS}
				/>
			</span>
		);
	}
	return (
		<div className="flex justify-end gap-8">
			<Button
				variant="outline"
				size="m"
				data-testid="workspace-creation-dismiss"
				onClick={() => dismissCreation(creation.id)}
			>
				{creation.state === "failed"
					? t("panels.workspaceCreation.dismiss")
					: t("panels.workspaceCreation.discard")}
			</Button>
			{creation.state === "failed" ? (
				<Button
					variant="outline"
					size="m"
					data-testid="workspace-creation-edit-retry"
					onClick={() => editAndRetryCreation(creation)}
				>
					{t("panels.workspaceCreation.editRetry")}
				</Button>
			) : null}
			<Button
				variant="primary"
				size="m"
				data-testid="workspace-creation-retry"
				onClick={() => retryCreation(creation.id)}
			>
				{t("panels.workspaceCreation.retry")}
			</Button>
		</div>
	);
}

function StateIcon({ creation, className }: { creation: WorkspaceCreation; className?: string }) {
	if (creation.state === "running")
		return (
			<Loader
				className={cn("size-14 shrink-0 animate-spin motion-reduce:animate-none", className)}
			/>
		);
	return (
		<ErrorWarning
			className={cn(
				"size-14 shrink-0",
				creation.state === "failed" ? "text-feedback-error" : "text-feedback-warning",
				className,
			)}
		/>
	);
}

export function WorkspaceCreationRow({
	creation,
	isActive,
	onSelect,
}: {
	creation: WorkspaceCreation;
	isActive: boolean;
	onSelect: () => void;
}) {
	const t = useT();
	const percent = percentOf(creation);
	const reason = statusReason(t, creation);
	const label = (
		<span
			data-testid="workspace-creation-status"
			className={cn(
				"truncate tr-text-metadata leading-tight",
				creation.state === "failed"
					? "text-feedback-error"
					: creation.state === "interrupted"
						? "text-feedback-warning"
						: "text-text-subtle",
			)}
		>
			{statusLabel(t, creation)}
		</span>
	);
	return (
		<li>
			<div
				data-testid="workspace-creation-row"
				data-state={creation.state}
				data-active={isActive}
				className={cn(
					"group relative flex min-h-panel-row min-w-0 items-center gap-8 rounded-sm py-2 pr-4 pl-24 transition-colors",
					isActive ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
				)}
			>
				<button
					type="button"
					onClick={onSelect}
					className="flex min-w-0 flex-1 items-start gap-4 text-left"
				>
					<StateIcon
						creation={creation}
						className={cn("mt-2", isActive ? "text-primary" : "text-text-muted")}
					/>
					<span className="flex min-w-0 flex-1 flex-col">
						<span
							className={`truncate tr-text-ui leading-tight ${isActive ? "text-primary" : "text-text-muted"}`}
						>
							{creation.name}
						</span>
						{reason ? (
							<IconTooltip label={reason} side="right">
								{label}
							</IconTooltip>
						) : (
							label
						)}
						{creation.state === "running" && percent !== null ? (
							<progress
								max={100}
								value={percent}
								aria-label={statusLabel(t, creation)}
								className="mt-2 h-2 w-full accent-primary"
							/>
						) : null}
					</span>
				</button>
				<CreationActions creation={creation} size="row" />
			</div>
		</li>
	);
}

export function WorkspaceCreationView({ creation }: { creation: WorkspaceCreation }) {
	const t = useT();
	const percent = percentOf(creation);
	const reason = statusReason(t, creation);
	const title =
		creation.state === "failed"
			? t("panels.workspaceCreation.failedTitle", { name: creation.name })
			: creation.state === "interrupted"
				? t("panels.workspaceCreation.interruptedTitle", { name: creation.name })
				: creation.phase === "preparing"
					? t("panels.workspaceCreation.preparing")
					: percent === null
						? t("panels.workspaceCreation.checkingOut")
						: t("panels.workspaceCreation.checkingOutAt", { percent });
	const detail = creation.progress
		? t("panels.workspaceCreation.fileCount", {
				done: creation.progress.done.toLocaleString(),
				total: creation.progress.total.toLocaleString(),
				base: creation.baseBranch,
			})
		: t("panels.workspaceCreation.fromBase", { base: creation.baseBranch });
	const kickoff =
		creation.kickoff && (creation.kickoff.text || creation.kickoff.imageCount > 0)
			? creation.kickoff
			: undefined;
	return (
		<div
			data-testid="workspace-creation-view"
			data-state={creation.state}
			className="flex h-full min-h-0 items-center justify-center p-24"
		>
			<div
				className={cn(
					"flex w-full max-w-lg flex-col gap-12 rounded-lg border bg-container-elevated-bg p-24",
					creation.state === "failed"
						? "border-feedback-error-muted"
						: creation.state === "interrupted"
							? "border-feedback-warning-muted"
							: "border-border-default",
				)}
			>
				<div className="flex items-center gap-8">
					<StateIcon creation={creation} />
					<h2
						className={cn(
							"tr-text-emphasis",
							creation.state === "failed"
								? "text-feedback-error"
								: creation.state === "interrupted"
									? "text-feedback-warning"
									: "text-text-default",
						)}
					>
						{title}
					</h2>
				</div>
				{creation.state === "failed" && reason ? (
					<pre
						data-testid="workspace-creation-reason"
						className="whitespace-pre-wrap text-feedback-error tr-code-text"
					>
						{reason}
					</pre>
				) : (
					<p className="text-text-muted tr-text-metadata">{reason ?? detail}</p>
				)}
				{creation.state === "running" && percent !== null ? (
					<progress
						max={100}
						value={percent}
						aria-label={title}
						className="h-4 w-full accent-primary"
					/>
				) : null}
				{creation.state === "failed" && creation.failure?.cleanedUp ? (
					<p className="text-text-muted tr-text-metadata">
						{t("panels.workspaceCreation.cleanedUp")}
					</p>
				) : null}
				{kickoff ? (
					<div className="flex flex-col gap-4">
						<p className="text-text-muted tr-text-metadata">
							{creation.state === "running"
								? t("panels.workspaceCreation.promptHeld")
								: t("panels.workspaceCreation.promptKept")}
						</p>
						<p
							data-testid="workspace-creation-prompt"
							className="whitespace-pre-wrap rounded-md border border-border-default p-12 text-text-default tr-text-ui"
						>
							{kickoff.text}
						</p>
						{kickoff.imageCount > 0 ? (
							<p className="text-text-subtle tr-text-metadata">
								{t("panels.workspaceCreation.images", { count: kickoff.imageCount })}
							</p>
						) : null}
					</div>
				) : null}
				<CreationActions creation={creation} size="card" />
			</div>
		</div>
	);
}

export function useCreationChatHandoff(): void {
	const pending = useAppStore((s) => s.creationChatToOpen);
	useEffect(() => {
		if (!pending) return;
		const handoff = useAppStore.getState().consumeCreationChat();
		if (!handoff) return;
		const { workspaceId, sessionId, kickoffError, sentPrompt } = handoff;
		if (!sessionId) {
			if (kickoffError) toast.error(kickoffError, translate("panels.newWorkspace.chatStartFailed"));
			return;
		}
		void openChatInTab(workspaceId, sessionId).then(() => {
			if (!kickoffError) return;
			const store = useAppStore.getState();
			if (sentPrompt && (sentPrompt.text || sentPrompt.attachments.length > 0))
				store.appendUserMessage(
					sessionId,
					sentPrompt.text,
					sentPrompt.attachments.length > 0 ? sentPrompt.attachments : undefined,
				);
			store.appendErrorTurn(sessionId, kickoffError);
		});
	}, [pending]);
}
