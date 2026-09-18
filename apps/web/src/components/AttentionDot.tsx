import { cn } from "@/lib";

export function AttentionDot({
	className,
	label = "Needs attention",
}: {
	className?: string;
	label?: string;
}) {
	return (
		<span
			data-testid="attention-dot"
			role="img"
			aria-label={label}
			className={cn("flex size-20 shrink-0 items-center justify-center", className)}
		>
			<span aria-hidden className="size-6 rounded-full bg-primary" />
		</span>
	);
}
