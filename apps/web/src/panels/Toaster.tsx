import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@/components/ui/toast";
import { useAppStore } from "@/store";

const AUTO_DISMISS_MS = 5000;

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
					<div className="flex min-w-0 flex-1 flex-col gap-4">
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
