// PlanRailPane — the TODO side-rail panel: the SAME compact rendering the chat popover uses
// (`TodoRows` + `TodoAddRow` from `../chat/TodoList`), scoped to the workspace's active chat.
// Intentionally NOT `PlanPane`: the user asked for the TODO list to live next to Files/Specs, not
// the document-scale Plan page. The full Plan page stays reachable through `plan.openPlan` (the
// FileText button inside `TodoAddRow`) and will land in center as before \u2014 see
// `plan-as-side-rail-rfc.md` for placement + `plan-chatless-work-surface-rfc.md` for the Now-block
// direction.
import { planGlance } from "../chat/planView";
import { TodoAddRow, TodoRows } from "../chat/TodoList";
import { useChatTodos } from "../chat/useChatTodos";
import { useAppStore } from "../store";

export default function PlanRailPane({
	workspaceId,
	sessionId,
}: {
	workspaceId: string;
	sessionId: string;
}) {
	const plan = useChatTodos(workspaceId, sessionId);
	// Glance drives the status glyph on in-progress rows. Mirror the chat strip's derivation so the
	// rail and the popover stay in lockstep.
	const glance = useAppStore((s) => {
		const runtime = s.sessions[sessionId];
		if (!runtime) return "waiting" as const;
		return planGlance(runtime.isStreaming, {});
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
		// Background is inherited from the rail panel chrome (same as Review / Changes / Files). An
		// explicit `bg-container-content-bg` here would paint the lighter editor-tab surface over the
		// darker rail background and the panel would stand out from its neighbours.
		<div data-testid="plan-rail-pane" className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="shrink-0 border-border-muted border-b">
				<TodoAddRow onAdd={plan.add} onOpenPlan={plan.openPlan} />
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-4">
				{empty ? (
					<p className="px-4 py-4 text-text-muted tr-text-metadata">
						No TODOs yet \u2014 the agent adds its plan here, or add one above.
					</p>
				) : (
					<TodoRows plan={plan.data} glance={glance} onOpenChanges={plan.openChanges} />
				)}
			</div>
		</div>
	);
}
