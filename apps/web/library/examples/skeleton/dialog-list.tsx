import { RiRefreshLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@thinkrail/ui/dialog";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { useRef, useState } from "react";
import { SettingsNotice } from "@/panels/SettingsNotice";

export default function DialogList() {
	const t = useT();
	const [loadError, setLoadError] = useState<string | null>(null);
	const timer = useRef(0);
	const load = () => {
		setLoadError(null);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(
			() => setLoadError(t("panels.existingWorktree.listFailed")),
			2000,
		);
	};
	return (
		<Dialog
			onOpenChange={(open) => {
				if (open) load();
				else window.clearTimeout(timer.current);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline">{t("panels.projectTree.openExistingWorktree")}</Button>
			</DialogTrigger>
			<DialogContent className="max-w-[36rem]">
				<DialogHeader>
					<DialogTitle>{t("panels.existingWorktree.title")}</DialogTitle>
					<DialogDescription>{t("panels.existingWorktree.description")}</DialogDescription>
				</DialogHeader>
				{loadError === null ? (
					<LoadingRegion
						rows={4}
						label={t("panels.existingWorktree.loading")}
						className="min-h-112 p-4"
						testId="existing-worktree-loading"
					/>
				) : (
					<SettingsNotice
						variant="error"
						action={
							<Button variant="outline" size="m" iconLeft={RiRefreshLine} onClick={load}>
								{t("common.retry")}
							</Button>
						}
					>
						{loadError}
					</SettingsNotice>
				)}
			</DialogContent>
		</Dialog>
	);
}
