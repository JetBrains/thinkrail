import {
	RiAlertLine,
	RiCheckboxCircleLine,
	RiErrorWarningLine,
	RiInformationLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@thinkrail/ui/toast";
import { cn } from "@thinkrail/ui/utils";

export default function Severities() {
	const t = useT();
	const toasts = [
		{
			variant: "info",
			Icon: RiInformationLine,
			iconClass: "text-feedback-info",
			title: t("plan.checkAll.runningTitle"),
			message: t("plan.checkAll.runningMessage"),
		},
		{
			variant: "success",
			Icon: RiCheckboxCircleLine,
			iconClass: "text-feedback-success",
			title: t("plan.review.startedTitle"),
			message: t("plan.review.startedMessage"),
		},
		{
			variant: "warning",
			Icon: RiAlertLine,
			iconClass: "text-feedback-warning",
			title: t("updates.native.disabled.title"),
			message: t("updates.native.disabled.detail"),
		},
		{
			variant: "error",
			Icon: RiErrorWarningLine,
			iconClass: "text-feedback-error",
			title: t("plan.copyFailed.title"),
			message: t("plan.copyFailed.message"),
		},
	] as const;
	return (
		<ToastProvider>
			{toasts.map(({ variant, Icon, iconClass, title, message }) => (
				<Toast key={variant} variant={variant} duration={Number.POSITIVE_INFINITY}>
					<div className="flex items-start gap-8">
						<Icon className={cn("mt-2 size-14 shrink-0", iconClass)} aria-hidden />
						<div className="flex min-w-0 flex-1 flex-col gap-4">
							<ToastTitle>{title}</ToastTitle>
							<ToastDescription>{message}</ToastDescription>
						</div>
						<ToastClose />
					</div>
				</Toast>
			))}
			<ToastViewport className="static" />
		</ToastProvider>
	);
}
