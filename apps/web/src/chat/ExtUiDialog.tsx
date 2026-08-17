import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { ExtUiDialogRequest } from "./types";

/**
 * Renders the active extension-UI dialog (pi's in-process `uiContext.select/confirm/input/editor`,
 * bridged over `pi.extensionUi`). `onReply` carries the value back to the agent; cancelling sends `false`
 * for `confirm`, `null` otherwise. Mount with `key={request.id}` so each dialog gets fresh local state.
 */
export function ExtUiDialog({
	request,
	onReply,
}: {
	request: ExtUiDialogRequest;
	onReply: (value: string | boolean | null) => void;
}) {
	const [text, setText] = useState(request.kind === "editor" ? (request.prefill ?? "") : "");
	const cancel = () => onReply(request.kind === "confirm" ? false : null);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) cancel();
			}}
		>
			<DialogContent data-testid="ext-ui-dialog" data-kind={request.kind}>
				<DialogHeader>
					<DialogTitle>{request.title}</DialogTitle>
					{request.kind === "confirm" ? (
						<DialogDescription>{request.message}</DialogDescription>
					) : null}
				</DialogHeader>

				{request.kind === "select" ? (
					<div className="flex flex-col gap-xs">
						{request.options.map((option) => (
							<button
								key={option}
								type="button"
								data-testid="ext-ui-option"
								onClick={() => onReply(option)}
								className="rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-md py-sm text-left tr-text-ui text-text-default outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
							>
								{option}
							</button>
						))}
					</div>
				) : null}

				{request.kind === "input" ? (
					<input
						data-testid="ext-ui-input"
						autoFocus
						value={text}
						placeholder={request.placeholder ?? ""}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								onReply(text);
							}
						}}
						className="rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-sm py-xs tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary-soft"
					/>
				) : null}

				{request.kind === "editor" ? (
					<textarea
						data-testid="ext-ui-editor"
						autoFocus
						value={text}
						rows={8}
						onChange={(e) => setText(e.target.value)}
						className="resize-none rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-sm py-xs tr-code-text text-text-default outline-none focus-visible:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary-soft"
					/>
				) : null}

				<DialogFooter>
					{request.kind === "confirm" ? (
						<>
							<Button variant="outline" data-testid="ext-ui-cancel" onClick={() => onReply(false)}>
								Cancel
							</Button>
							<Button data-testid="ext-ui-confirm" onClick={() => onReply(true)}>
								OK
							</Button>
						</>
					) : request.kind === "input" || request.kind === "editor" ? (
						<>
							<Button variant="outline" data-testid="ext-ui-cancel" onClick={cancel}>
								Cancel
							</Button>
							<Button data-testid="ext-ui-submit" onClick={() => onReply(text)}>
								Submit
							</Button>
						</>
					) : (
						<Button variant="outline" data-testid="ext-ui-cancel" onClick={cancel}>
							Cancel
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
