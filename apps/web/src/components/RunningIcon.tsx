import type { ReactNode } from "react";
import { cn } from "@/lib";

export function RunningIcon({
	children,
	className,
}: {
	children: ReactNode;
	className?: string | undefined;
}) {
	return (
		<span
			data-testid="running-icon"
			data-running="true"
			role="img"
			aria-label="Agent working"
			className={cn(
				"inline-flex items-center justify-center motion-safe:animate-pulse motion-reduce:rounded-[var(--radius-sm)] motion-reduce:ring-1 motion-reduce:ring-current",
				className,
			)}
		>
			<span aria-hidden className="inline-flex items-center justify-center">
				{children}
			</span>
		</span>
	);
}
