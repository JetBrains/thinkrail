import { RiLoader4Line as Loader2 } from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { errorText, getTransport } from "../transport";

export function RenameWorkspaceDialog({
	workspace,
	open,
	canSubmit,
	onOpenChange,
}: {
	workspace: Workspace;
	open: boolean;
	canSubmit: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const inputId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState(workspace.name);
	const [renaming, setRenaming] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const rename = async () => {
		if (!canSubmit || !name.trim() || renaming) return;
		setRenaming(true);
		setError(null);
		try {
			await getTransport().request("workspace.rename", { id: workspace.id, name });
			setRenaming(false);
			onOpenChange(false);
		} catch (err) {
			setError(errorText(err, "Failed to rename workspace"));
			setRenaming(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !renaming && onOpenChange(next)}>
			<DialogContent
				hideClose
				data-testid="rename-workspace-dialog"
				className="max-w-[24rem]"
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
						void rename();
					}}
				>
					<DialogHeader>
						<DialogTitle>Rename workspace</DialogTitle>
						<DialogDescription>
							Renames this workspace and its Git branch. The workspace folder stays in place.
						</DialogDescription>
					</DialogHeader>

					<label htmlFor={inputId} className="flex flex-col gap-4">
						<span className="tr-text-eyebrow text-text-subtle">Workspace name</span>
						<input
							ref={inputRef}
							id={inputId}
							data-testid="rename-workspace-input"
							type="text"
							value={name}
							disabled={renaming}
							aria-invalid={error ? true : undefined}
							onChange={(event) => {
								setName(event.target.value);
								setError(null);
							}}
							className="w-full rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text"
						/>
					</label>

					{error ? (
						<p
							data-testid="rename-workspace-error"
							aria-live="polite"
							className="text-feedback-error tr-text-metadata"
						>
							{error}
						</p>
					) : null}

					<DialogFooter>
						<Button
							data-testid="rename-workspace-cancel"
							variant="outline"
							disabled={renaming}
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							data-testid="rename-workspace-submit"
							disabled={!canSubmit || renaming || !name.trim()}
						>
							{renaming ? <Loader2 className="size-14 animate-spin" /> : null}
							Rename
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
