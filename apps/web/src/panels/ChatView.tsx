import { useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { ChatMessageView } from "./ChatMessageView";

/**
 * One chat session as a center tab: a virtualized message list (sticks to the bottom while streaming)
 * over a minimal send box. The full Composer (steer/followUp/@-mentions/images) arrives at M12.
 */
export default function ChatView({ sessionId }: { sessionId: string }) {
	const messages = useAppStore((s) => s.messages);
	const isStreaming = useAppStore((s) => s.isStreaming);
	const [draft, setDraft] = useState("");

	const send = async () => {
		const text = draft.trim();
		if (!text) return;
		setDraft("");
		useAppStore.getState().appendUserMessage(text);
		try {
			// `promptSession` steers when a turn is already streaming, so one method covers both.
			await getTransport().request("session.prompt", { sessionId, text });
		} catch {
			// Turn failures surface via the pi.event stream; a dedicated error pass comes later.
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-bg">
			<Virtuoso
				data={messages}
				className="min-h-0 flex-1"
				followOutput="smooth"
				itemContent={(_index, message) => (
					<div
						className="mx-auto max-w-3xl px-md py-xs"
						data-testid="chat-message"
						data-role={message.role}
					>
						<ChatMessageView message={message} />
					</div>
				)}
			/>
			<form
				className="flex shrink-0 items-end gap-sm border-t border-border2 bg-bg-dark p-sm"
				onSubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<textarea
					data-testid="chat-input"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void send();
						}
					}}
					rows={2}
					placeholder="Message the agent…  (Enter to send · Shift+Enter for newline)"
					className="min-h-0 flex-1 resize-none rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm py-xs text-sm text-text outline-none placeholder:text-hint focus:border-primary"
				/>
				<Button type="submit" size="sm" disabled={!draft.trim()} data-testid="chat-send">
					{isStreaming ? "Steer" : "Send"}
				</Button>
			</form>
		</div>
	);
}
