import type { ReactNode } from "react";

export function Subtitle({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<p
			className={`max-w-[600px] text-[1.08rem] leading-relaxed font-[350] whitespace-pre-line text-text-muted ${className}`}
		>
			{children}
		</p>
	);
}
