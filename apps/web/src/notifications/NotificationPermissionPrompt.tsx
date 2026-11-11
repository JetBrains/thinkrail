import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useRef } from "react";
import { toast, useAppStore } from "@/store";
import { selectNotificationChannel } from "./channel";
import { snoozePrompt } from "./notificationPrompt";

export function NotificationPermissionPrompt() {
	const t = useT();
	const open = useAppStore((state) => state.notificationPromptOpen);
	const pendingRef = useRef(false);

	const dismiss = () => {
		snoozePrompt();
		useAppStore.getState().closeNotificationPrompt();
	};

	const enable = () => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		void selectNotificationChannel()
			.requestPermission()
			.then((result) => {
				if (result === "denied")
					toast.error(
						t("notifications.permission.deniedHint"),
						t("notifications.permission.deniedTitle"),
					);
			})
			.finally(() => {
				pendingRef.current = false;
				useAppStore.getState().closeNotificationPrompt();
			});
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) dismiss();
			}}
		>
			<DialogContent data-testid="notification-permission-prompt">
				<DialogHeader>
					<DialogTitle>{t("notifications.permission.title")}</DialogTitle>
					<DialogDescription>{t("notifications.permission.description")}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" size="l" data-testid="notification-not-now" onClick={dismiss}>
						{t("notifications.permission.notNow")}
					</Button>
					<Button variant="primary" size="l" data-testid="notification-enable" onClick={enable}>
						{t("notifications.permission.enable")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
