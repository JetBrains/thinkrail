import {
	RiAlertLine,
	RiArrowGoBackLine,
	RiCheckboxCircleLine,
	RiErrorWarningLine,
	RiFileCopyLine,
	RiInformationLine,
	RiPlayLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
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
import { useRef, useState } from "react";

type Variant = "info" | "success" | "warning" | "error";

interface Item {
	id: number;
	variant: Variant;
	message: string;
	title?: string;
	durationMs?: number;
	action?: { label: string; onClick: () => void };
}

const ICONS: Record<Variant, { Icon: typeof RiAlertLine; className: string }> = {
	info: { Icon: RiInformationLine, className: "text-feedback-info" },
	success: { Icon: RiCheckboxCircleLine, className: "text-feedback-success" },
	warning: { Icon: RiAlertLine, className: "text-feedback-warning" },
	error: { Icon: RiErrorWarningLine, className: "text-feedback-error" },
};

export default function Queue() {
	const t = useT();
	const [toasts, setToasts] = useState<Item[]>([]);
	const nextId = useRef(0);
	const push = (item: Omit<Item, "id">) => {
		nextId.current += 1;
		setToasts((list) => [...list, { ...item, id: nextId.current }]);
	};
	const dismiss = (id: number) => setToasts((list) => list.filter((item) => item.id !== id));
	return (
		<ToastProvider swipeDirection="right">
			<div className="flex flex-wrap gap-8">
				<Button
					variant="outline"
					size="m"
					iconLeft={RiFileCopyLine}
					onClick={() =>
						push({
							variant: "success",
							title: t("plan.copied.title"),
							message: t("plan.copied.message"),
						})
					}
				>
					{t("common.copy")}
				</Button>
				<Button
					variant="outline"
					size="m"
					iconLeft={RiArrowGoBackLine}
					onClick={() =>
						push({
							variant: "success",
							message: t("panels.diffSurface.revertedFile", { file: "src/app.ts" }),
							durationMs: 8000,
							action: { label: t("panels.diffSurface.undo"), onClick: () => {} },
						})
					}
				>
					{t("panels.diffPane.revertFile")}
				</Button>
				<Button
					variant="outline"
					size="m"
					iconLeft={RiPlayLine}
					onClick={() =>
						push({
							variant: "error",
							title: t("plan.review.startFailed"),
							message: "The host is not connected.",
						})
					}
				>
					{t("plan.item.checkIt")}
				</Button>
			</div>
			{toasts.map((item) => {
				const { Icon, className } = ICONS[item.variant];
				return (
					<Toast
						key={item.id}
						variant={item.variant}
						duration={
							item.durationMs ?? (item.variant === "error" ? Number.POSITIVE_INFINITY : 5000)
						}
						onOpenChange={(open) => {
							if (!open) dismiss(item.id);
						}}
					>
						<div className="flex items-start gap-8">
							<Icon className={cn("mt-2 size-14 shrink-0", className)} aria-hidden />
							<div className="flex min-w-0 flex-1 flex-col gap-4">
								{item.title ? <ToastTitle>{item.title}</ToastTitle> : null}
								<ToastDescription className={item.title ? undefined : "text-text-default"}>
									{item.message}
								</ToastDescription>
							</div>
							<ToastClose />
						</div>
						{item.action ? (
							<div className="mt-12 flex justify-end">
								<ToastAction altText={item.action.label} asChild>
									<Button variant="outline" size="m" onClick={item.action.onClick}>
										{item.action.label}
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
