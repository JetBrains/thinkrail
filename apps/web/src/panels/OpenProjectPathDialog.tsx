import { RiAlertLine as Alert } from "@remixicon/react";
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

export function OpenProjectPathDialog({
	open,
	reason,
	onOpenChange,
	onSubmit,
}: {
	open: boolean;
	reason: string | null;
	onOpenChange: (open: boolean) => void;
	onSubmit: (path: string) => void;
}) {
	const [path, setPath] = useState("");
	const finalPath = path.trim();

	const setOpen = (next: boolean) => {
		if (!next) setPath("");
		onOpenChange(next);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent data-testid="open-project-path-dialog" className="max-w-[30rem] gap-12">
				<DialogHeader>
					<DialogTitle>Open project from host path</DialogTitle>
					<DialogDescription>
						Enter a folder path on the computer running ThinkRail. Use{" "}
						<code className="tr-code-text">~/</code> for the host account&apos;s home folder.
					</DialogDescription>
				</DialogHeader>

				{reason ? (
					<p
						data-testid="open-project-picker-error"
						className="flex items-start gap-8 text-feedback-warning tr-text-ui"
					>
						<Alert className="mt-2 size-16 shrink-0" />
						<span className="min-w-0 whitespace-pre-wrap break-words">{reason}</span>
					</p>
				) : null}

				<form
					className="flex flex-col gap-12"
					onSubmit={(event) => {
						event.preventDefault();
						if (!finalPath) return;
						onSubmit(finalPath);
						setOpen(false);
					}}
				>
					<label htmlFor="open-project-host-path" className="flex flex-col gap-4">
						<span className="tr-title-compact text-text-default">Folder path</span>
						<input
							id="open-project-host-path"
							data-testid="open-project-path-input"
							autoFocus
							autoComplete="off"
							spellCheck={false}
							value={path}
							onChange={(event) => setPath(event.target.value)}
							placeholder="~/projects/example"
							className="w-full rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active"
						/>
					</label>
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit" data-testid="open-project-path-submit" disabled={!finalPath}>
							Open project
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
