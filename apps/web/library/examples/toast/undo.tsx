import { RiArrowGoBackLine, RiCheckboxCircleLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Toast,
	ToastAction,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastViewport,
} from "@thinkrail/ui/toast";
import { useState } from "react";

export default function Undo() {
	const t = useT();
	const [open, setOpen] = useState(true);
	return (
		<ToastProvider>
			<div className="flex w-full flex-col items-start gap-8">
				<Button
					variant="outline"
					size="m"
					iconLeft={RiArrowGoBackLine}
					onClick={() => setOpen(true)}
				>
					{t("panels.diffPane.revertFile")}
				</Button>
				<Toast variant="success" open={open} onOpenChange={setOpen} duration={8000}>
					<div className="flex items-start gap-8">
						<RiCheckboxCircleLine
							className="mt-2 size-14 shrink-0 text-feedback-success"
							aria-hidden
						/>
						<div className="flex min-w-0 flex-1 flex-col gap-4">
							<ToastDescription className="text-text-default">
								{t("panels.diffSurface.revertedFile", { file: "src/app.ts" })}
							</ToastDescription>
						</div>
						<ToastClose />
					</div>
					<div className="mt-12 flex justify-end">
						<ToastAction altText={t("panels.diffSurface.undo")} asChild>
							<Button variant="outline" size="m" onClick={() => {}}>
								{t("panels.diffSurface.undo")}
							</Button>
						</ToastAction>
					</div>
				</Toast>
				<ToastViewport className="static" />
			</div>
		</ToastProvider>
	);
}
