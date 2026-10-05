import { RiNotification3Line as NotificationIcon } from "@remixicon/react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { toast, useAppStore } from "@/store";
import { snoozePrompt } from "./notificationPrompt";
import { requestNotificationPermission } from "./webNotifications";

const DENIED_HINT =
	"Notifications are blocked for this site. Re-enable them in your browser's site settings, then turn notifications on again.";

export function NotificationPermissionPrompt() {
	const open = useAppStore((state) => state.notificationPromptOpen);
	const pendingRef = useRef(false);

	const dismiss = () => {
		snoozePrompt();
		useAppStore.getState().closeNotificationPrompt();
	};

	const enable = () => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		void requestNotificationPermission()
			.then((result) => {
				if (result === "denied") toast.error(DENIED_HINT, "Notifications blocked");
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
					<DialogTitle className="flex items-center gap-8">
						<NotificationIcon className="size-16 text-text-muted" />
						Get notified when a worktree needs you
					</DialogTitle>
					<DialogDescription>
						ThinkRail can notify you when an agent asks a question, finishes, or fails — even when the
						app is in a background tab. Notifications only appear while this window isn't focused.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col gap-8 sm:flex-row sm:justify-end">
					<Button variant="outline" data-testid="notification-not-now" onClick={dismiss}>
						Not now
					</Button>
					<Button data-testid="notification-enable" onClick={enable}>
						Enable
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
