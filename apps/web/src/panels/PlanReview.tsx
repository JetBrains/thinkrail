import { useState } from "react";

// The review verdict controls (task-agent-reviewer): the manual **Approve** / **Ask to fix** pair the
// plan page unfolds INLINE next to a reviewable item's changes (`PlanPane`'s `ChangeSetBlock` →
// `manually` toggle). This is the human override that sits beside the agent-reviewer flow; there is no
// separate summary-first "Review mode" page any more (findings live in the right-panel Review tab, and
// the plan header's comment chip navigates there — see task-plan-review-kebab).

/**
 * The review verdict pair — **Approve** + **Ask to fix** — shown inline under a reviewable item's
 * change set (the actions live NEXT TO the changes).
 */
export function ReviewActions({
	itemId,
	onApprove,
	onAskFix,
}: {
	itemId: string;
	onApprove: (id: string) => Promise<void>;
	onAskFix: (id: string, feedback: string) => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	const approve = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await onApprove(itemId);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="mt-md flex items-start gap-sm" data-testid="review-actions">
			<button
				type="button"
				data-testid="review-approve"
				disabled={busy}
				onClick={() => void approve()}
				className="rounded-[var(--radius-sm)] bg-primary px-sm py-xs tr-text-ui text-text-on-primary hover:opacity-90 disabled:opacity-50"
			>
				Approve
			</button>
			<AskFixForm onSend={(feedback) => onAskFix(itemId, feedback)} />
		</div>
	);
}

/** The Ask-to-fix affordance: a button that unfolds into a feedback textarea + Send/Cancel. */
function AskFixForm({ onSend }: { onSend: (feedback: string) => Promise<void> }) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	if (!open) {
		return (
			<button
				type="button"
				data-testid="review-fix"
				onClick={() => setOpen(true)}
				className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
			>
				Ask to fix
			</button>
		);
	}
	const send = async () => {
		const feedback = text.trim();
		if (!feedback || busy) return;
		setBusy(true);
		try {
			await onSend(feedback);
			setOpen(false);
			setText("");
		} catch {
			// keep the typed feedback so the user can retry; useChatTodos surfaced the failure
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex w-full flex-col gap-xs" data-testid="review-fix-form">
			<textarea
				data-testid="review-fix-input"
				value={text}
				onChange={(e) => setText(e.target.value)}
				// Focus on mount — the form only exists after an explicit "Ask to fix" click.
				ref={(el) => el?.focus()}
				rows={3}
				placeholder="What should change? The agent gets this step, its summary, its diff, and your note."
				className="w-full resize-y rounded-[var(--radius-sm)] border border-border-default bg-container-content-bg px-sm py-xs tr-text-ui text-text-default outline-none placeholder:text-text-muted focus:border-control-border-active"
			/>
			<div className="flex items-center gap-sm">
				<button
					type="button"
					data-testid="review-fix-send"
					disabled={busy || !text.trim()}
					onClick={() => void send()}
					className="rounded-[var(--radius-sm)] bg-primary px-sm py-xs tr-text-ui text-text-on-primary hover:opacity-90 disabled:opacity-50"
				>
					{busy ? "Sending…" : "Send to agent"}
				</button>
				<button
					type="button"
					onClick={() => setOpen(false)}
					className="rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-muted hover:bg-control-bg-hovered"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
