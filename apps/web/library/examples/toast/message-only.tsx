import { RiInformationLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastViewport,
} from "@thinkrail/ui/toast";

export default function MessageOnly() {
	const t = useT();
	return (
		<ToastProvider>
			<Toast variant="info" duration={Number.POSITIVE_INFINITY}>
				<div className="flex items-start gap-8">
					<RiInformationLine className="mt-2 size-14 shrink-0 text-feedback-info" aria-hidden />
					<div className="flex min-w-0 flex-1 flex-col gap-4">
						<ToastDescription className="text-text-default">
							{t("panels.diffSurface.staleView")}
						</ToastDescription>
					</div>
					<ToastClose />
				</div>
			</Toast>
			<ToastViewport className="static" />
		</ToastProvider>
	);
}
