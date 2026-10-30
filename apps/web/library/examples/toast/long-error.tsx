import { RiErrorWarningLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@thinkrail/ui/toast";

const detail =
	"ENOENT: no such file or directory, open '/Users/me/projects/thinkrail/.pi/worktrees/feature-rework-the-review-pipeline/.cache/review-session-0f3c9a.json'";

export default function LongError() {
	const t = useT();
	return (
		<ToastProvider>
			<Toast variant="error" duration={Number.POSITIVE_INFINITY}>
				<div className="flex items-start gap-8">
					<RiErrorWarningLine className="mt-2 size-14 shrink-0 text-feedback-error" aria-hidden />
					<div className="flex min-w-0 flex-1 flex-col gap-4">
						<ToastTitle>{t("plan.review.startFailed")}</ToastTitle>
						<ToastDescription>{detail}</ToastDescription>
					</div>
					<ToastClose />
				</div>
			</Toast>
			<ToastViewport className="static" />
		</ToastProvider>
	);
}
