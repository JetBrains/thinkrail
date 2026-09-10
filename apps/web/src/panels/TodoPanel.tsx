import { useShallow } from "zustand/react/shallow";
import { type PlanGlance, planSummary, sessionGlance } from "../chat/planView";
import { TodoAddRow, TodoEmptyGuidance, TodoRows } from "../chat/TodoList";
import { type ChatTodos, useChatTodos } from "../chat/useChatTodos";
import { QuietScrollArea } from "../components/QuietScrollArea";
import { LoadingRegion } from "../components/Skeleton";
import { selectTodoChatTarget, type TodoChatTarget, useAppStore } from "../store";

export function TodoPanelSessionView({
	target,
	plan,
	glance,
}: {
	target: TodoChatTarget;
	plan: ChatTodos;
	glance: PlanGlance;
}) {
	const summary = plan.data ? planSummary(plan.data) : null;
	const empty = plan.data ? plan.data.todos.length === 0 && plan.data.groups.length === 0 : false;
	return (
		<div
			data-testid="todo-panel"
			data-session-id={target.sessionId}
			className="flex h-full min-h-0 flex-col"
		>
			<div
				data-testid="todo-panel-context"
				className="flex h-panel-header-row shrink-0 items-center gap-8 border-border-default border-b px-12"
			>
				<span className="min-w-0 flex-1 truncate tr-title-compact text-text-default">
					{target.title}
				</span>
				{summary ? (
					<span className="shrink-0 tr-text-metadata text-text-muted">
						{summary.done} / {summary.total}
					</span>
				) : plan.failed ? null : (
					<span
						aria-hidden="true"
						className="h-3 w-24 animate-pulse rounded-[var(--radius-sm)] bg-control-bg-hovered"
					/>
				)}
			</div>
			{plan.data ? (
				<>
					<div className="shrink-0 border-border-muted border-b">
						<TodoAddRow onAdd={plan.add} onOpenPlan={plan.openPlan} />
					</div>
					<QuietScrollArea className="min-h-0 flex-1" viewportClassName="p-4">
						{empty ? (
							<TodoEmptyGuidance />
						) : (
							<div className="motion-safe:animate-reveal">
								<TodoRows
									plan={plan.data}
									onRemove={plan.remove}
									glance={glance}
									onOpenChanges={plan.openChanges}
								/>
							</div>
						)}
					</QuietScrollArea>
				</>
			) : plan.failed ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-12 text-center">
					<p className="tr-text-ui text-text-subtle">Couldn&apos;t load this TODO list.</p>
					<button
						type="button"
						data-testid="todo-panel-retry"
						onClick={() => void plan.reload()}
						className="rounded-[var(--radius-sm)] border border-border-default px-8 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						Retry
					</button>
				</div>
			) : (
				<LoadingRegion rows={8} label="Loading TODO list" className="min-h-0 flex-1 p-12" />
			)}
		</div>
	);
}

export function useTodoPanelGlance(sessionId: string): PlanGlance {
	return useAppStore((state) => {
		const runtime = state.sessions[sessionId];
		return state.status === "connected" &&
			state.connectionGeneration !== 0 &&
			runtime?.syncedConnectionGeneration === state.connectionGeneration
			? sessionGlance(runtime)
			: "waiting";
	});
}

function TodoPanelSession({ target }: { target: TodoChatTarget }) {
	const plan = useChatTodos(target.workspaceId, target.sessionId);
	const glance = useTodoPanelGlance(target.sessionId);
	return <TodoPanelSessionView target={target} plan={plan} glance={glance} />;
}

export function TodoPanelAvailability({ remembered }: { remembered: boolean }) {
	if (remembered) {
		return (
			<div data-testid="todo-panel" className="h-full min-h-0">
				<LoadingRegion rows={8} label="Loading TODO list" className="h-full p-12" />
			</div>
		);
	}
	return (
		<div
			data-testid="todo-panel"
			className="flex h-full items-center justify-center px-12 text-center tr-text-ui text-text-subtle"
		>
			Focus a chat to see its TODO list
		</div>
	);
}

export function useTodoPanelTarget(): TodoChatTarget | null {
	return useAppStore(useShallow(selectTodoChatTarget));
}

export function TodoPanel() {
	const target = useTodoPanelTarget();
	const remembered = useAppStore((state) => {
		const workspaceId = state.activeWorkspaceId;
		if (!workspaceId) return false;
		const sessionId = state.layoutAttentionByWorkspace[workspaceId]?.lastFocusedChatSessionId;
		return Boolean(sessionId && !state.deletedSessionsByWorkspace[workspaceId]?.[sessionId]);
	});

	if (target) {
		return <TodoPanelSession key={`${target.workspaceId}:${target.sessionId}`} target={target} />;
	}
	return <TodoPanelAvailability remembered={remembered} />;
}
