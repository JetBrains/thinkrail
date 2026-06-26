import type { AssistantMessage, UserMessage } from "@thinkrail-pi/contracts";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import type { ChatTurn, ToolResultState } from "./types";

/**
 * Render a chat turn. Presentational + props-driven (no store/transport) so the renderers stay reusable;
 * `ChatView` is the app-integration layer that feeds these from the store. `toolResults` pairs a tool
 * call (inside an assistant turn) with its output by `toolCallId`.
 */
export function ChatTurnView({
	turn,
	toolResults,
}: {
	turn: ChatTurn;
	toolResults: Record<string, ToolResultState>;
}) {
	switch (turn.kind) {
		case "user":
			return <UserTurn message={turn.message} />;
		case "assistant":
			return (
				<AssistantTurn
					message={turn.message}
					streaming={turn.streaming}
					toolResults={toolResults}
				/>
			);
		case "system":
			return <SystemTurn text={turn.text} />;
		default:
			return null;
	}
}

function userText(content: UserMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("");
}

function UserTurn({ message }: { message: UserMessage }) {
	return (
		<div data-testid="chat-message" data-role="user" className="flex justify-end">
			<div className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--bubble-user-border)] bg-[var(--bubble-user-bg)] px-md py-sm text-sm text-text">
				{userText(message.content)}
			</div>
		</div>
	);
}

/** Walk the assistant message's content blocks IN ORDER: text → markdown, thinking → block, toolCall → card. */
function AssistantTurn({
	message,
	streaming,
	toolResults,
}: {
	message: AssistantMessage;
	streaming: boolean;
	toolResults: Record<string, ToolResultState>;
}) {
	return (
		<div
			data-testid="chat-message"
			data-role="assistant"
			className="flex flex-col gap-sm text-sm text-text"
		>
			{message.content.map((block, index) => {
				if (block.type === "toolCall") {
					return (
						<ToolCard
							key={block.id}
							toolName={block.name}
							args={block.arguments}
							tool={toolResults[block.id]}
						/>
					);
				}
				// Text/thinking blocks have no id; their array position is stable (pi appends, never reorders),
				// so the index is a correct, safe key here.
				const key = `${block.type}-${index}`;
				if (block.type === "text") {
					return block.text ? <Markdown key={key} text={block.text} /> : null;
				}
				if (block.type === "thinking") {
					return block.thinking ? <ThinkingBlock key={key} text={block.thinking} /> : null;
				}
				return null;
			})}
			{streaming ? <span className="inline-block animate-pulse text-primary">▍</span> : null}
		</div>
	);
}

function ThinkingBlock({ text }: { text: string }) {
	return (
		<details className="rounded-[var(--radius-sm)] border border-border2 bg-elevated px-sm py-xs text-muted text-xs">
			<summary className="cursor-pointer select-none">Thinking</summary>
			<div className="mt-xs whitespace-pre-wrap">{text}</div>
		</details>
	);
}

function SystemTurn({ text }: { text: string }) {
	return (
		<div data-testid="chat-message" data-role="system" className="text-center text-hint text-xs">
			{text}
		</div>
	);
}
