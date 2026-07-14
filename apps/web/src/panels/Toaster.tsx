import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@/components/ui/toast";
import { useAppStore } from "@/store";

/** How long a self-clearing toast lingers; errors override this to persist until dismissed. */
const AUTO_DISMISS_MS = 5000;

/**
 * The app-wide toast host: subscribes to the store's `toasts` and renders each via the Radix primitives.
 * Mounted once by the shell. Errors persist until dismissed (they carry something worth reading twice);
 * success/info time out on their own. Radix owns the timer + swipe/hover-pause — a close (timeout, swipe,
 * or the X) routes back through `dismissToast`, keeping the store the single source of truth.
 */
export function Toaster() {
	const toasts = useAppStore((s) => s.toasts);
	const dismissToast = useAppStore((s) => s.dismissToast);
	return (
		<ToastProvider swipeDirection="right">
			{toasts.map((t) => (
				<Toast
					key={t.id}
					variant={t.variant}
					duration={t.variant === "error" ? Number.POSITIVE_INFINITY : AUTO_DISMISS_MS}
					onOpenChange={(open) => {
						if (!open) dismissToast(t.id);
					}}
					data-testid="toast"
					data-variant={t.variant}
				>
					<div className="flex min-w-0 flex-1 flex-col gap-xs">
						{t.title ? <ToastTitle>{t.title}</ToastTitle> : null}
						<ToastDescription>{t.message}</ToastDescription>
					</div>
					<ToastClose />
				</Toast>
			))}
			<ToastViewport />
		</ToastProvider>
	);
}
