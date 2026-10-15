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
import type { Toast as ToastType } from "@/store";
import { useAppStore } from "@/store";

const variantIcon: Record<ToastType["variant"], { Icon: typeof RiAlertLine; className: string }> = {
	error: { Icon: RiErrorWarningLine, className: "text-feedback-error" },
	success: { Icon: RiCheckboxCircleLine, className: "text-feedback-success" },
	warning: { Icon: RiAlertLine, className: "text-feedback-warning" },
	info: { Icon: RiInformationLine, className: "text-feedback-info" },
};

const AUTO_DISMISS_MS = 5000;

export function Toaster() {
	const toasts = useAppStore((s) => s.toasts);
	const dismissToast = useAppStore((s) => s.dismissToast);
	return (
		<ToastProvider swipeDirection="right">
			{toasts.map((t) => {
				const { Icon, className: iconClass } = variantIcon[t.variant];
				return (
					<Toast
						key={t.id}
						variant={t.variant}
						duration={
							t.durationMs ?? (t.variant === "error" ? Number.POSITIVE_INFINITY : AUTO_DISMISS_MS)
						}
						onOpenChange={(open) => {
							if (!open) dismissToast(t.id);
						}}
						data-testid="toast"
						data-variant={t.variant}
					>
						<div className="flex items-start gap-8">
							<Icon className={cn("mt-2 size-14 shrink-0", iconClass)} aria-hidden />
							<div className="flex min-w-0 flex-1 flex-col gap-4">
								{t.title ? <ToastTitle>{t.title}</ToastTitle> : null}
								<ToastDescription className={t.title ? undefined : "text-text-default"}>
									{t.message}
								</ToastDescription>
							</div>
							<ToastClose />
						</div>
						{t.action ? (
							<div className="mt-12 flex justify-end">
								<ToastAction altText={t.action.label} asChild>
									<Button
										variant="outline"
										size="sm"
										data-testid="toast-action"
										onClick={t.action.onClick}
									>
										{t.action.label}
									</Button>
								</ToastAction>
							</div>
						) : null}
					</Toast>
				);
			})}
			<ToastViewport />
		</ToastProvider>
	);
}
