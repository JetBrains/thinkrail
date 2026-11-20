import { RiExternalLinkLine, RiQuestionLine, RiRefreshLine } from "@remixicon/react";
import type { StatusItemHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { answerInbox, cardPeekEntry, type InboxItem, inboxTarget, loadInbox } from "./api";
import { INBOX_REASON_LABELS } from "./labels";
import { useAnyBoardChanged, useHostQuery } from "./useHostQuery";

/** The cross-project inbox, re-read on any board's change (a bound chat's state flip included). */
export function useInbox(host: StatusItemHost): InboxItem[] {
	const inbox = useHostQuery("inbox", (signal) => loadInbox(host, signal));
	useAnyBoardChanged(host, inbox.reload);
	return inbox.state.kind === "ready" ? inbox.state.value : [];
}

export function InboxRow({
	item,
	host,
	compact,
	onAct,
}: {
	item: InboxItem;
	host: StatusItemHost;
	compact: boolean;
	onAct?: () => void;
}) {
	const t = useT();
	const { card, reason } = item;
	const target = inboxTarget(item);
	const peek = () => {
		host.peek(cardPeekEntry(item.projectId, card));
		onAct?.();
	};
	const answer = () => {
		answerInbox(host, item);
		onAct?.();
	};
	return (
		<li
			data-testid="board-inbox-row"
			data-card-id={card.id}
			data-project-id={item.projectId}
			data-reason={reason}
			className={cn(
				"flex min-w-0 rounded-sm border bg-container-elevated-bg px-8 py-4",
				reason === "failed" ? "border-feedback-error-muted" : "border-feedback-warning-muted",
				compact ? "w-full flex-col gap-2" : "max-w-480 items-center gap-8",
			)}
		>
			<span className="flex min-w-0 flex-1 items-center gap-8">
				<span
					data-testid="board-inbox-project"
					className="max-w-120 shrink-0 truncate rounded-xs bg-control-bg-hovered px-4 tr-text-metadata text-text-muted"
				>
					{item.projectName}
				</span>
				<button
					type="button"
					data-testid="board-inbox-card"
					disabled={host.scope === null}
					aria-label={t("board.inbox.peek", { id: card.id, title: card.title })}
					onClick={peek}
					className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden rounded-xs text-left focus-visible:focus-ring enabled:hover:underline"
				>
					<span className="shrink-0 tr-code-text-small text-text-muted">{card.id}</span>
					<span className="min-w-0 truncate tr-text-ui text-text-default">{card.title}</span>
				</button>
			</span>
			<span className={cn("flex shrink-0 items-center gap-8", compact && "justify-between")}>
				<span
					className={cn(
						"tr-text-metadata",
						reason === "failed" ? "text-feedback-error" : "text-feedback-warning",
					)}
				>
					{t(INBOX_REASON_LABELS[reason])}
				</span>
				{target ? (
					<>
						<Button
							variant={reason === "failed" ? "outline" : "soft-primary"}
							size="s"
							iconLeft={reason === "failed" ? RiRefreshLine : RiQuestionLine}
							data-testid="board-inbox-answer"
							onClick={answer}
						>
							{reason === "failed" ? t("board.inbox.retry") : t("board.inbox.answer")}
						</Button>
						<IconButton
							icon={RiExternalLinkLine}
							size="s"
							label={t("board.inbox.openWorkspace")}
							data-testid="board-inbox-workspace"
							onClick={() => {
								host.openChat(target);
								onAct?.();
							}}
						/>
					</>
				) : null}
			</span>
		</li>
	);
}

/** "Needs you" across every open project, above the board, as chips that wrap. */
export function InboxStrip({ host, items }: { host: StatusItemHost; items: readonly InboxItem[] }) {
	const t = useT();
	if (items.length === 0) return null;
	return (
		<section
			data-testid="board-inbox-strip"
			aria-label={t("board.inbox.label")}
			className="flex shrink-0 flex-wrap items-center gap-8 border-border-muted border-b bg-feedback-warning-subtle px-8 py-4"
		>
			<span className="flex shrink-0 items-center gap-8">
				<span className="tr-text-emphasis text-feedback-warning">
					{t("board.inbox.title", { n: items.length })}
				</span>
				<span className="tr-text-metadata text-text-subtle">{t("board.inbox.allProjects")}</span>
			</span>
			<ul className="flex min-w-0 flex-wrap items-center gap-4">
				{items.map((item) => (
					<InboxRow
						key={`${item.projectId}:${item.card.id}`}
						item={item}
						host={host}
						compact={false}
					/>
				))}
			</ul>
		</section>
	);
}
