import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";

export function AttentionDot({ className }: { className?: string }) {
	const t = useT();
	return (
		<span
			data-testid="attention-dot"
			role="img"
			aria-label={t("components.attentionDot.label")}
			className={cn("flex size-20 shrink-0 items-center justify-center", className)}
		>
			<span aria-hidden className="size-6 rounded-full bg-primary" />
		</span>
	);
}
