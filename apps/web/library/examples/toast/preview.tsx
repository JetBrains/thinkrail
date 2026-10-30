import { RiCheckboxCircleLine, RiFileCopyLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@thinkrail/ui/toast";
import { useState } from "react";

export default function Preview() {
	const t = useT();
	const [open, setOpen] = useState(true);
	return (
		<ToastProvider>
			<div className="flex w-full flex-col items-start gap-8">
				<Button variant="outline" size="m" iconLeft={RiFileCopyLine} onClick={() => setOpen(true)}>
					{t("common.copy")}
				</Button>
				<Toast
					variant="success"
					open={open}
					onOpenChange={setOpen}
					duration={Number.POSITIVE_INFINITY}
				>
					<div className="flex items-start gap-8">
						<RiCheckboxCircleLine
							className="mt-2 size-14 shrink-0 text-feedback-success"
							aria-hidden
						/>
						<div className="flex min-w-0 flex-1 flex-col gap-4">
							<ToastTitle>{t("plan.copied.title")}</ToastTitle>
							<ToastDescription>{t("plan.copied.message")}</ToastDescription>
						</div>
						<ToastClose />
					</div>
				</Toast>
				<ToastViewport className="static p-0 sm:w-full" />
			</div>
		</ToastProvider>
	);
}
