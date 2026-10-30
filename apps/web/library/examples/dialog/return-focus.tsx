import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useRef, useState } from "react";

export default function ReturnFocus() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const opener = useRef<HTMLButtonElement>(null);
	return (
		<>
			<Button ref={opener} variant="ghost" size="m" tone="danger" onClick={() => setOpen(true)}>
				{t("resources.inspector.stopAll")}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						opener.current?.focus();
					}}
				>
					<DialogTitle>{t("chat.view.stopAllTitle")}</DialogTitle>
					<DialogDescription>{t("chat.view.stopAllDescription", { count: 3 })}</DialogDescription>
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)}>
							{t("common.cancel")}
						</Button>
						<Button variant="destructive" onClick={() => setOpen(false)}>
							{t("chat.view.stopAllConfirm", { count: 3 })}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
