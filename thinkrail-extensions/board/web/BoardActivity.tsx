import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { type ReactNode, useEffect, useState } from "react";
import {
	type ActivityEntry,
	type AgentEntry,
	cardIdPeekEntry,
	elapsedText,
	loadActivity,
	loadAgents,
	sortAgents,
	type Transition,
} from "./api";
import { AgentBadgeChip, LastActionLine, PlanProgress } from "./CardParts";
import { ACTOR_LABELS, columnTitle } from "./labels";
import { type Loaded, useAnyBoardActivity, useAnyBoardChanged, useHostQuery } from "./useHostQuery";

const FEED_LIMIT = 50;
const CLOCK_MS = 30_000;

function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
		return () => clearInterval(timer);
	}, []);
	return now;
}

function placement(t: Translator, value: Transition["from"]): string {
	return value ? columnTitle(t, value.column) : t("board.activity.none");
}

function moveText(t: Translator, entry: ActivityEntry): string {
	if (entry.from === null) return t("board.activity.created", { to: placement(t, entry.to) });
	if (entry.to === null) return t("board.feed.deleted");
	return t("board.activity.move", { from: placement(t, entry.from), to: placement(t, entry.to) });
}

function Column({
	title,
	testId,
	state,
	empty,
	children,
}: {
	title: string;
	testId: string;
	state: Loaded<readonly unknown[]>;
	empty: string;
	children: ReactNode;
}) {
	const t = useT();
	return (
		<section
			data-testid={testId}
			aria-label={title}
			className="flex min-h-0 min-w-0 flex-1 flex-col border-border-muted first:border-r"
		>
			<h3 className="shrink-0 px-8 py-4 tr-text-emphasis text-text-default">{title}</h3>
			{state.kind === "loading" ? (
				<LoadingRegion rows={4} label={t("board.loading")} className="overflow-hidden px-8" />
			) : state.kind === "error" ? (
				<p role="alert" className="px-8 tr-text-metadata text-feedback-error wrap-anywhere">
					{state.message}
				</p>
			) : state.value.length === 0 ? (
				<p className="px-8 tr-text-metadata text-text-subtle">{empty}</p>
			) : (
				<ul className="flex min-h-0 flex-col overflow-auto px-4 pb-4">{children}</ul>
			)}
		</section>
	);
}

function CardLink({
	host,
	projectId,
	cardId,
	title,
}: {
	host: Pick<PanelHost, "peek">;
	projectId: string;
	cardId: string;
	title?: string | undefined;
}) {
	const t = useT();
	return (
		<button
			type="button"
			data-testid="board-feed-card"
			aria-label={t("board.inbox.peek", { id: cardId, title: title ?? "" })}
			onClick={() => host.peek(cardIdPeekEntry(projectId, cardId, title))}
			className="shrink-0 rounded-xs tr-code-text-small text-text-muted hover:underline focus-visible:focus-ring"
		>
			{cardId}
		</button>
	);
}

function Feed({ host, state }: { host: PanelHost; state: Loaded<ActivityEntry[]> }) {
	const t = useT();
	return (
		<Column
			title={t("board.feed.title")}
			testId="board-feed"
			state={state}
			empty={t("board.feed.empty")}
		>
			{state.kind === "ready"
				? state.value.map((entry) => (
						<li
							key={`${entry.projectId}:${entry.cardId}:${entry.at}:${entry.reason}`}
							data-testid="board-feed-item"
							data-actor={entry.actor}
							data-card-id={entry.cardId}
							className="flex min-w-0 items-center gap-8 rounded-xs px-4 py-2 tr-text-metadata text-text-muted"
						>
							<time
								className="shrink-0 whitespace-nowrap tabular-nums text-text-subtle"
								dateTime={new Date(entry.at).toISOString()}
								title={new Date(entry.at).toLocaleString()}
							>
								{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
							</time>
							<CardLink
								host={host}
								projectId={entry.projectId}
								cardId={entry.cardId}
								title={entry.title}
							/>
							<span
								data-testid="board-feed-actor"
								className="shrink-0 rounded-xs bg-control-bg-hovered px-4 text-text-default"
							>
								{t(ACTOR_LABELS[entry.actor])}
							</span>
							<span className="min-w-0 truncate text-text-default">{moveText(t, entry)}</span>
							<span className="min-w-0 shrink truncate text-text-subtle">{entry.projectName}</span>
						</li>
					))
				: null}
		</Column>
	);
}

function Agents({ host, state }: { host: PanelHost; state: Loaded<AgentEntry[]> }) {
	const t = useT();
	const now = useNow();
	const agents = state.kind === "ready" ? sortAgents(state.value) : [];
	return (
		<Column
			title={t("board.agents.title", { n: agents.length })}
			testId="board-agents"
			state={state}
			empty={t("board.agents.empty")}
		>
			{agents.map((agent) => (
				<li key={`${agent.workspaceId}:${agent.sessionId}`}>
					<button
						type="button"
						data-testid="board-agent"
						data-card-id={agent.cardId}
						data-state={agent.state}
						aria-label={t("board.agents.open", { id: agent.cardId, title: agent.title })}
						onClick={() => host.peek(cardIdPeekEntry(agent.projectId, agent.cardId, agent.title))}
						onDoubleClick={() =>
							host.openWorkspace({
								workspaceId: agent.workspaceId,
								projectId: agent.projectId,
								sessionId: agent.sessionId,
							})
						}
						className="flex w-full min-w-0 flex-col gap-2 rounded-xs px-4 py-4 text-left hover:bg-control-bg-hovered focus-visible:focus-ring"
					>
						<span className="flex w-full min-w-0 items-center gap-8">
							<AgentBadgeChip badge={agent.state} />
							<span className="shrink-0 tr-code-text-small text-text-muted">{agent.cardId}</span>
							<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">
								{agent.title}
							</span>
							<PlanProgress plan={agent.plan} />
							<span
								data-testid="board-agent-elapsed"
								className="shrink-0 tabular-nums tr-text-metadata text-text-subtle"
							>
								{elapsedText(agent.startedAt, now)}
							</span>
						</span>
						{agent.state === "working" ? <LastActionLine action={agent.lastAction} /> : null}
					</button>
				</li>
			))}
		</Column>
	);
}

/**
 * Board view's bottom: what is happening across the open projects — the newest moves with their actor
 * and the agents working, waiting or failed — re-read on any board's change and any agent's action.
 */
export default function BoardActivity({ host }: PanelProps) {
	const t = useT();
	const feed = useHostQuery("feed", (signal) => loadActivity(host, { limit: FEED_LIMIT }, signal));
	const agents = useHostQuery("agents", (signal) => loadAgents(host, signal));
	const reload = () => {
		feed.reload();
		agents.reload();
	};
	useAnyBoardChanged(host, reload);
	useAnyBoardActivity(host, agents.reload);
	return (
		<section
			data-testid="board-activity-tool"
			aria-label={t("board.feed.region")}
			className="flex h-full min-h-0 bg-container-sidebar-bg"
		>
			<Feed host={host} state={feed.state} />
			<Agents host={host} state={agents.state} />
		</section>
	);
}
