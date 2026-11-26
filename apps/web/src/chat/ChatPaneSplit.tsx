import { useT } from "@thinkrail/locales/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { type ReactNode, useId, useRef } from "react";

const CHAT_PANE_DEFAULT_WIDTH = 50;
const CHAT_PANE_MIN_WIDTH = 25;
const CHAT_MIN_WIDTH = 30;

/** What the shell shows beside a chat, inside the chat's tab. */
export interface ChatPaneSlot {
	/** The chat action this pane shows; the header's toggle for it reads pressed. */
	readonly id: string;
	readonly label: string;
	readonly content: ReactNode;
	/** The pane's share of the chat's tab in percent; `null` for the default. */
	readonly width: number | null;
	readonly onWidthChange: (width: number) => void;
	readonly onClose: () => void;
}

function chatPaneWidth(width: number | null): number {
	if (width === null) return CHAT_PANE_DEFAULT_WIDTH;
	return Math.min(100 - CHAT_MIN_WIDTH, Math.max(CHAT_PANE_MIN_WIDTH, width));
}

export function ChatPaneSplit({
	pane,
	children,
}: {
	pane: ChatPaneSlot | undefined;
	children: ReactNode;
}) {
	const t = useT();
	const id = useId();
	const draggingRef = useRef(false);
	const pendingWidthRef = useRef<number | null>(null);
	const onWidthChange = pane?.onWidthChange;
	return (
		<ResizablePanelGroup
			direction="horizontal"
			data-testid="chat-split"
			className="min-h-0 min-w-0"
			onLayout={(layout) => {
				const width = layout[1];
				if (width === undefined || !onWidthChange) return;
				if (draggingRef.current) pendingWidthRef.current = width;
				else onWidthChange(width);
			}}
		>
			<ResizablePanel id={`${id}chat`} order={1} minSize={CHAT_MIN_WIDTH}>
				{children}
			</ResizablePanel>
			{pane ? (
				<>
					<ResizableHandle
						direction="horizontal"
						data-testid="chat-pane-resize"
						aria-label={t("chat.pane.resize")}
						onDragging={(dragging) => {
							draggingRef.current = dragging;
							const pending = pendingWidthRef.current;
							if (dragging || pending === null) return;
							pendingWidthRef.current = null;
							pane.onWidthChange(pending);
						}}
					/>
					<ResizablePanel
						id={`${id}pane`}
						order={2}
						defaultSize={chatPaneWidth(pane.width)}
						minSize={CHAT_PANE_MIN_WIDTH}
					>
						<section
							data-testid="chat-pane"
							data-pane={pane.id}
							aria-label={pane.label}
							className="h-full min-h-0 min-w-0 overflow-hidden bg-container-content-bg"
						>
							{pane.content}
						</section>
					</ResizablePanel>
				</>
			) : null}
		</ResizablePanelGroup>
	);
}
