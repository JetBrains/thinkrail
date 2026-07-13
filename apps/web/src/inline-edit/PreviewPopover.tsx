import { useMemo } from "react";
import { ChatActionsContext } from "@/chat/ChatActions";
import { type ChatRow, deriveRows } from "@/chat/rows";
import { ChatTurnView } from "@/chat/turns";
import { EMPTY_RUNTIME, useAppStore } from "@/store";

/** No-op ChatActions: the preview is read-only, so an interactive tool card can't send anything. */
const READONLY_ACTIONS = { answerQuestion: async () => undefined };

/**
 * Read-only live transcript for a hidden inline-edit session, anchored near its work site. Reuses the chat
 * renderers (presentational by design) — no composer, no interactivity. Closes via `onClose`; "open in tab"
 * promotes the session.
 */
export function PreviewPopover({
	sessionId,
	rect,
	onClose,
	onOpenInTab,
}: {
	sessionId: string;
	rect: { top: number; left: number };
	onClose: () => void;
	onOpenInTab: () => void;
}) {
	const runtime = useAppStore((s) => s.sessions[sessionId]) ?? EMPTY_RUNTIME;
	const rows = useMemo<ChatRow[]>(
		() => deriveRows(runtime.turns, runtime.toolResults, runtime.isStreaming),
		[runtime.turns, runtime.toolResults, runtime.isStreaming],
	);
	return (
		<div
			data-testid="inline-edit-preview-popover"
			style={{ position: "fixed", top: rect.top, left: rect.left }}
			className="z-[41] flex max-h-[320px] w-[400px] flex-col overflow-hidden rounded-[var(--radius-md)] border border-border2 bg-elevated shadow-[var(--shadow-lg)]"
		>
			<div className="flex items-center gap-xs border-border2 border-b px-sm py-xs text-primary text-[11px]">
				<span className="size-1.5 animate-pulse rounded-full bg-primary" />
				<span className="flex-1 truncate">inline edit · live</span>
				<button
					type="button"
					data-testid="inline-edit-preview-open-tab"
					onClick={onOpenInTab}
					className="rounded-[var(--radius-sm)] border border-border2 px-1.5 py-0.5 text-text text-[10px] hover:bg-hover"
				>
					tab
				</button>
				<button
					type="button"
					data-testid="inline-edit-preview-close"
					onClick={onClose}
					className="rounded-[var(--radius-sm)] border border-border2 px-1.5 py-0.5 text-text text-[10px] hover:bg-hover"
				>
					✕
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-auto px-sm py-xs">
				<ChatActionsContext.Provider value={READONLY_ACTIONS}>
					{rows.map((row) => (
						<div key={row.id} className="py-0.5 text-xs">
							<ChatTurnView row={row} workspaceRoot={undefined} onOpenChanges={() => {}} />
						</div>
					))}
				</ChatActionsContext.Provider>
			</div>
		</div>
	);
}
