import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@thinkrail/ui/dialog";

export default function Preview() {
	const t = useT();
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="outline">{t("settings.notifications.enable")}</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("notifications.permission.title")}</DialogTitle>
					<DialogDescription>{t("notifications.permission.description")}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">{t("notifications.permission.notNow")}</Button>
					</DialogClose>
					<DialogClose asChild>
						<Button>{t("notifications.permission.enable")}</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
