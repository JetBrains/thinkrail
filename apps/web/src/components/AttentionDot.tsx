import { cn } from "@/lib";

export function AttentionDot({ className }: { className?: string }) {
	return (
		<span
			data-testid="attention-dot"
			role="img"
			aria-label="Needs attention"
			className={cn("flex size-20 shrink-0 items-center justify-center", className)}
		>
			<span aria-hidden className="size-6 rounded-full bg-primary" />
		</span>
	);
}
