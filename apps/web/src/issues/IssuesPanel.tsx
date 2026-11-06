import { type RemixiconComponentType, RiCodeBoxLine, RiQuillPenLine } from "@remixicon/react";
import type {
	IssueConnection,
	IssueConnectionInput,
	IssueReference,
	IssueStage,
	IssueSummary,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { useEffect, useReducer } from "react";
import { GitLabAssociationForm } from "./GitLabAssociationForm";
import {
	associationPanelState,
	type ConnectResult,
	ISSUE_ACTION_KEY,
	ISSUE_ACTION_REASON_KEY,
	ISSUE_ERROR_KEY,
	type IssueActionCapabilities,
	type IssueActionId,
	type IssueActionResult,
	type IssuePanelError,
	issueActions,
	issueKey,
	reconnectOutcome,
	safeIssueUrl,
	submitDisconnect,
} from "./model";

export interface IssuesPanelProps {
	connection: IssueConnection | null;
	issues: readonly IssueSummary[];
	pending: boolean;
	authSupported: boolean;
	capabilities: IssueActionCapabilities;
	error?: IssuePanelError | undefined;
	onConnect: (input: IssueConnectionInput) => Promise<ConnectResult>;
	onDisconnect: () => Promise<unknown>;
	onRefresh: () => void;
	onOpenIssue?: ((reference: IssueReference) => Promise<void> | void) | undefined;
	onRunAction?:
		| ((issue: IssueSummary, action: IssueActionId) => Promise<IssueActionResult>)
		| undefined;
	actionPending?: boolean | undefined;
	actionError?: IssuePanelError | null | undefined;
	/** The issue whose last action failed; its row carries the message inline. */
	actionErrorIssue?: string | undefined;
	/** Grants project trust so the host stops refusing stage actions. */
	onTrustProject?: (() => void) | undefined;
}

interface IssueActionRowProps {
	issue: IssueSummary;
	capabilities: IssueActionCapabilities;
	pending: boolean;
	/** Keyed failure raised by this issue's last action, shown beside its own controls. */
	error?: IssuePanelError | null | undefined;
	onRun: (action: IssueActionId) => void;
}

const ACTION_ICON: Record<IssueActionId, RemixiconComponentType> = {
	design: RiQuillPenLine,
	implement: RiCodeBoxLine,
};

/** One issue's stage actions on the title row; a blocked icon names its reason in the tooltip. */
function IssueActionRow({ issue, capabilities, pending, error, onRun }: IssueActionRowProps) {
	const t = useT();
	const actions = issueActions(issue, capabilities);
	if (actions.length === 0) return null;
	return (
		<TooltipProvider>
			<div data-testid="issue-actions" className="flex shrink-0 items-start gap-2">
				{error != null && (
					<span data-testid="issue-action-error" className="text-feedback-error">
						{t(ISSUE_ERROR_KEY[error])}
					</span>
				)}
				{actions.map(({ action, reason, done }) => {
					const label = t(ISSUE_ACTION_KEY[action]);
					const hint = capabilities.startupSupported === false ? t("mcp.action.openChat") : label;
					return (
						<IconButton
							key={action}
							size="s"
							variant={done ? "soft-primary" : "ghost"}
							icon={ACTION_ICON[action]}
							label={label}
							tooltip={reason === null ? hint : `${label} — ${t(ISSUE_ACTION_REASON_KEY[reason])}`}
							data-testid={`issue-action-${action}`}
							data-reason={reason ?? undefined}
							data-done={done ? "true" : undefined}
							data-disabled={reason !== null ? "true" : undefined}
							disabled={pending || reason !== null}
							onClick={() => {
								if (reason === null) onRun(action);
							}}
						/>
					);
				})}
			</div>
		</TooltipProvider>
	);
}

const stages: IssueStage[] = ["backlog", "in-progress", "in-review", "closed"];
const STAGE_KEY = {
	backlog: "issues.stage.backlog",
	"in-progress": "issues.stage.in-progress",
	"in-review": "issues.stage.in-review",
	closed: "issues.stage.closed",
} as const satisfies Record<IssueStage, MessageKey>;

export function IssuesPanel({
	connection,
	issues,
	pending,
	authSupported,
	capabilities,
	error,
	onConnect,
	onDisconnect,
	onRefresh,
	onOpenIssue,
	onRunAction,
	actionPending,
	actionError,
	actionErrorIssue,
	onTrustProject,
}: IssuesPanelProps) {
	const t = useT();
	const [state, dispatch] = useReducer(reconnectOutcome, error ?? null, associationPanelState);
	// Nothing reaches the host until the user confirms this issue's implementation gate.
	const { reconnecting, snapshotError } = state;
	const showForm = !connection?.connected || reconnecting;
	const failure = actionError ?? state.actionError ?? snapshotError;

	useEffect(() => {
		if (!pending) dispatch({ type: "snapshotLanded", error: error ?? null });
	}, [error, pending]);

	const refresh = () => {
		dispatch({ type: "clearActionError" });
		onRefresh();
	};

	const connect = async (input: IssueConnectionInput) => {
		dispatch({ type: "clearActionError" });
		const result = await onConnect(input);
		dispatch(
			result.ok ? { type: "connectSucceeded" } : { type: "connectFailed", error: result.error },
		);
		return result;
	};

	const run = (issue: IssueSummary, action: IssueActionId) => {
		dispatch({ type: "clearActionError" });
		void onRunAction?.(issue, action);
	};

	const disconnect = () => {
		dispatch({ type: "clearActionError" });
		void submitDisconnect(onDisconnect).then((ok) => {
			dispatch(ok ? { type: "clearActionError" } : { type: "actionFailed", error: "disconnect" });
		});
	};

	return (
		<div className="flex flex-col gap-12 p-panel-inset tr-text-ui">
			{failure && (
				<p role="alert" data-testid="issues-error" className="break-words text-feedback-error">
					{t(ISSUE_ERROR_KEY[failure])}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-8">
				<Button variant="ghost" size="s" disabled={pending} onClick={refresh}>
					{t("issues.refresh")}
				</Button>
				{connection && (
					<Button
						variant="ghost"
						size="s"
						tone="danger"
						data-testid="issues-disconnect"
						disabled={pending}
						onClick={disconnect}
					>
						{t("issues.disconnect")}
					</Button>
				)}
				{connection?.connected && authSupported && !reconnecting && (
					<Button
						variant="ghost"
						size="s"
						data-testid="issues-reconnect"
						onClick={() => dispatch({ type: "startReconnect" })}
					>
						{t("issues.reconnect")}
					</Button>
				)}
			</div>
			{pending && (
				<p role="status" className="text-text-muted">
					{t("common.loading")}
				</p>
			)}
			{connection && (
				<div className="flex flex-col gap-4">
					{(connection.connected || authSupported) && (
						<p data-testid="issues-state" className="break-words text-text-muted">
							{connection.connected ? t("issues.connected") : t("issues.reconnectHint")}
						</p>
					)}
					<p className="break-words text-text-muted">
						{connection.instanceUrl} · {connection.remoteProjectId}
					</p>
				</div>
			)}
			{!authSupported && (
				<p data-testid="issues-auth-unsupported" className="text-feedback-warning">
					{t("issues.authUnsupported")}
				</p>
			)}
			{showForm && (
				<GitLabAssociationForm
					connection={connection}
					pending={pending}
					authSupported={authSupported}
					onConnect={connect}
					onError={(connectError) =>
						dispatch(
							connectError
								? { type: "connectFailed", error: connectError }
								: { type: "clearActionError" },
						)
					}
					{...(connection?.connected && reconnecting
						? { onCancelReconnect: () => dispatch({ type: "cancelReconnect" }) }
						: {})}
				/>
			)}
			{!pending && !failure && connection?.connected && issues.length === 0 && (
				<p className="text-text-muted">{t("issues.empty")}</p>
			)}
			{stages.map((stage) => (
				<section key={stage} className="flex flex-col gap-8" aria-label={t(STAGE_KEY[stage])}>
					<h3 className="text-text-muted tr-text-ui">
						{t(STAGE_KEY[stage])} · {issues.filter((issue) => issue.stage === stage).length}
					</h3>
					{issues
						.filter((issue) => issue.stage === stage)
						.map((issue) => (
							<article
								key={issueKey(issue)}
								className="flex flex-col gap-4 rounded-sm border border-border-muted p-8"
							>
								<div className="flex items-start gap-6">
									<a
										href={safeIssueUrl(issue.url)}
										target="_blank"
										rel="noopener noreferrer"
										className="min-w-0 flex-1 break-words text-primary"
									>
										#{issue.reference.number} {issue.title}
									</a>
									{onRunAction && (
										<IssueActionRow
											issue={issue}
											capabilities={capabilities}
											pending={actionPending === true}
											error={actionErrorIssue === issueKey(issue) ? actionError : null}
											onRun={(action) => run(issue, action)}
										/>
									)}
								</div>
								<p className="text-text-subtle">{t(STAGE_KEY[stage])}</p>
								{issue.labels.length > 0 && (
									<p className="break-words text-text-muted">{issue.labels.join(" · ")}</p>
								)}
								{onTrustProject && capabilities.trusted === false && (
									<Button
										size="s"
										variant="outline"
										disabled={pending}
										onClick={() => {
											dispatch({ type: "clearActionError" });
											onTrustProject();
										}}
									>
										{t("issues.trustAction")}
									</Button>
								)}
								{onOpenIssue && (
									<Button
										size="s"
										variant="ghost"
										disabled={pending}
										onClick={() => {
											dispatch({ type: "clearActionError" });
											void Promise.resolve()
												.then(() => onOpenIssue(issue.reference))
												.catch(() => dispatch({ type: "actionFailed", error: "open" }));
										}}
									>
										{t("issues.open")}
									</Button>
								)}
							</article>
						))}
				</section>
			))}
		</div>
	);
}
