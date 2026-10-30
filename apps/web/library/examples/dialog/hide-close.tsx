import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@thinkrail/ui/dialog";
import { useState } from "react";

export default function HideClose() {
	const t = useT();
	const [error, setError] = useState<string | null>(null);
	return (
		<Dialog
			open={error !== null}
			onOpenChange={(open) => {
				if (!open) setError(null);
			}}
		>
			<DialogTrigger asChild>
				<Button
					variant="outline"
					onClick={() => setError(t("panels.openProject.missing", { path: "~/old-repo" }))}
				>
					{t("panels.openProjectPath.submit")}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-sm" hideClose>
				<DialogHeader>
					<DialogTitle>{t("panels.openProject.openFailed")}</DialogTitle>
					<DialogDescription className="whitespace-pre-line">{error}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={() => setError(null)}>{t("panels.noticeDialog.ok")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
