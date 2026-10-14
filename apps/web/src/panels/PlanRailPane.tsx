import { useEffect } from "react";
import { hostSessionGlance, sessionGlance } from "../chat/planView";
import { TodoAddRow, TodoRows } from "../chat/TodoList";
import { useChatTodos } from "../chat/useChatTodos";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

export default function PlanRailPane({
	workspaceId,
	sessionId,
}: {
	workspaceId: string;
	sessionId: string;
}) {
	const plan = useChatTodos(workspaceId, sessionId);
	useEffect(() => {
		void getTransport()
			.request("todo.list", { workspaceId, sessionId, opened: "rail" })
			.catch(() => {});
	}, [workspaceId, sessionId]);
	const glance = useAppStore((s) => {
		const runtime = s.sessions[sessionId];
		if (!runtime) return "waiting" as const;
		return hostSessionGlance(runtime.hostState, sessionGlance(runtime));
	});

	if (plan.data === null) {
		return (
			<div
				data-testid="plan-rail-loading"
				className="flex h-full items-center justify-center p-16 text-text-subtle tr-text-ui"
			>
				{plan.failed ? "Couldn't load the TODO list." : "Loading\u2026"}
			</div>
		);
	}

	const empty = plan.data.todos.length === 0 && plan.data.groups.length === 0;

	return (
		<div
			data-testid="plan-rail-pane"
			data-glance={glance}
			className="flex h-full min-h-0 flex-col overflow-hidden"
		>
			<div className="shrink-0 border-border-muted border-b">
				<TodoAddRow onAdd={(title) => plan.add(title, "rail")} onOpenPlan={plan.openPlan} />
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-4">
				{empty ? (
					<p className="px-4 py-4 text-text-muted tr-text-metadata">
						No TODOs yet — the agent adds its plan here, or add one above.
					</p>
				) : (
					<TodoRows
						plan={plan.data}
						glance={glance}
						onOpenChanges={plan.openChanges}
						onRemove={plan.remove}
					/>
				)}
			</div>
		</div>
	);
}
