import { RiAlertLine as Alert } from "@remixicon/react";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useState } from "react";

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
	const t = useT();
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
					<DialogTitle>{t("panels.openProjectPath.title")}</DialogTitle>
					<DialogDescription>
						<T
							i18nKey="panels.openProjectPath.description"
							components={[<code key="home" className="tr-code-text" />]}
						/>
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
						<span className="tr-title-compact text-text-default">
							{t("panels.openProjectPath.folderPath")}
						</span>
						<input
							id="open-project-host-path"
							data-testid="open-project-path-input"
							autoFocus
							autoComplete="off"
							spellCheck={false}
							value={path}
							onChange={(event) => setPath(event.target.value)}
							placeholder={t("panels.openProjectPath.placeholder")}
							className="w-full rounded-sm border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active"
						/>
					</label>
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)}>
							{t("common.cancel")}
						</Button>
						<Button type="submit" data-testid="open-project-path-submit" disabled={!finalPath}>
							{t("panels.openProjectPath.submit")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
