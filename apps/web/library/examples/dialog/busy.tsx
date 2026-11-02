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
import { useRef, useState } from "react";

export default function Busy() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const clone = () => {
		setBusy(true);
		timer.current = setTimeout(() => {
			setBusy(false);
			setOpen(false);
		}, 3000);
	};
	const cancel = () => {
		clearTimeout(timer.current);
		setBusy(false);
		if (!busy) setOpen(false);
	};
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next || !busy) setOpen(next);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline">{t("panels.cloneProject.title")}</Button>
			</DialogTrigger>
			<DialogContent hideClose={busy} className="max-w-lg gap-12">
				<DialogHeader>
					<DialogTitle>{t("panels.cloneProject.title")}</DialogTitle>
					<DialogDescription>{t("panels.cloneProject.description")}</DialogDescription>
				</DialogHeader>
				{busy ? (
					<p role="status" className="tr-text-ui text-text-muted">
						{t("panels.cloneProject.cloning")}
					</p>
				) : null}
				<DialogFooter>
					<Button variant="outline" onClick={cancel}>
						{t("common.cancel")}
					</Button>
					<Button disabled={busy} onClick={clone}>
						{t("panels.cloneProject.clone")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
