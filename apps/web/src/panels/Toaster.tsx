import {
	RiAlertLine,
	RiCheckboxCircleLine,
	RiErrorWarningLine,
	RiInformationLine,
} from "@remixicon/react";
import { Button } from "@thinkrail/ui/button";
import {
	Toast,
	ToastAction,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@thinkrail/ui/toast";
import { cn } from "@thinkrail/ui/utils";
import { useRef } from "react";
import type { ToastCloseReason, Toast as ToastType } from "@/store";
import { useAppStore } from "@/store";

const variantIcon: Record<ToastType["variant"], { Icon: typeof RiAlertLine; className: string }> = {
	error: { Icon: RiErrorWarningLine, className: "text-feedback-error" },
	success: { Icon: RiCheckboxCircleLine, className: "text-feedback-success" },
	warning: { Icon: RiAlertLine, className: "text-feedback-warning" },
	info: { Icon: RiInformationLine, className: "text-feedback-info" },
};

const AUTO_DISMISS_MS = 5000;

function ToastItem({ toast }: { toast: ToastType }) {
	const dismissToast = useAppStore((s) => s.dismissToast);
	const closeReason = useRef<ToastCloseReason>("expired");
	const closedByUser = () => {
		closeReason.current = "dismissed";
	};
	const { action, onClose } = toast;
	const { Icon, className: iconClass } = variantIcon[toast.variant];
	return (
		<Toast
			variant={toast.variant}
			duration={
				toast.durationMs ?? (toast.variant === "error" ? Number.POSITIVE_INFINITY : AUTO_DISMISS_MS)
			}
			onSwipeEnd={closedByUser}
			onEscapeKeyDown={closedByUser}
			onOpenChange={(open) => {
				if (open) return;
				onClose?.(closeReason.current);
				dismissToast(toast.id);
			}}
			data-testid="toast"
			data-variant={toast.variant}
		>
			<div className="flex items-start gap-8">
				<Icon className={cn("mt-2 size-14 shrink-0", iconClass)} aria-hidden />
				<div className="flex min-w-0 flex-1 flex-col gap-4">
					{toast.title ? <ToastTitle>{toast.title}</ToastTitle> : null}
					<ToastDescription className={toast.title ? undefined : "text-text-default"}>
						{toast.message}
					</ToastDescription>
				</div>
				<ToastClose onClick={closedByUser} />
			</div>
			{action ? (
				<div className="mt-12 flex justify-end">
					<ToastAction altText={action.label} asChild>
						<Button
							variant="outline"
							size="m"
							data-testid="toast-action"
							onClick={() => {
								closeReason.current = "action";
								action.onClick();
							}}
						>
							{action.label}
						</Button>
					</ToastAction>
				</div>
			) : null}
		</Toast>
	);
}

export function Toaster() {
	const toasts = useAppStore((s) => s.toasts);
	return (
		<ToastProvider swipeDirection="right">
			{toasts.map((t) => (
				<ToastItem key={t.id} toast={t} />
			))}
			<ToastViewport />
		</ToastProvider>
	);
}
