import { SESSION_TITLE_MAX_LENGTH } from "@thinkrail/contracts";
import { useEffect, useRef, useState } from "react";
import { prepareChatTitle } from "../chat/chatTitle";
import { Button } from "../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { toast } from "../store";
import { errorText, getTransport } from "../transport";

export interface RenameChatTarget {
	workspaceId: string;
	sessionId: string;
	title: string;
}

export function RenameChatDialog({
	target,
	onClose,
}: {
	target: RenameChatTarget | null;
	onClose: () => void;
}) {
	const [title, setTitle] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!target) return;
		setTitle(target.title);
		setError(null);
		setSaving(false);
	}, [target]);

	const save = async () => {
		if (!target || saving) return;
		const prepared = prepareChatTitle(title);
		if ("reason" in prepared) {
			setError(prepared.reason);
			return;
		}
		if (prepared.title === target.title) {
			onClose();
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await getTransport().request("session.rename", {
				workspaceId: target.workspaceId,
				sessionId: target.sessionId,
				title: prepared.title,
			});
			onClose();
		} catch (requestError) {
			toast.error(errorText(requestError), "Couldn't rename the chat");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open && !saving) onClose();
			}}
		>
			<DialogContent
				data-testid="rename-chat-dialog"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					inputRef.current?.focus();
					inputRef.current?.select();
				}}
			>
				<form
					className="flex flex-col gap-16"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<DialogHeader>
						<DialogTitle>Rename chat</DialogTitle>
						<DialogDescription>Change the name shown in tabs and chat history.</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						<label htmlFor="rename-chat-title" className="tr-text-emphasis text-text-default">
							Name
						</label>
						<input
							ref={inputRef}
							id="rename-chat-title"
							data-testid="rename-chat-input"
							value={title}
							disabled={saving}
							aria-invalid={error !== null}
							onChange={(event) => {
								setTitle(event.target.value);
								setError(null);
							}}
							className="w-full rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none transition-colors focus-visible:border-control-border-active disabled:bg-control-disabled-bg disabled:text-control-disabled-text"
						/>
						<div className="flex items-start justify-between gap-8 tr-text-metadata">
							{error ? (
								<p data-testid="rename-chat-error" className="text-feedback-error">
									{error}
								</p>
							) : (
								<span />
							)}
							<span
								className={
									title.length > SESSION_TITLE_MAX_LENGTH
										? "shrink-0 text-feedback-error"
										: "shrink-0 text-text-muted"
								}
							>
								{title.length}/{SESSION_TITLE_MAX_LENGTH}
							</span>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" disabled={saving} onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="submit"
							data-testid="rename-chat-save"
							disabled={saving || title === target?.title}
						>
							{saving ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
