import { type ReactNode, useState } from "react";

const THRESHOLD = 24;

export function Collapsible({
	lines,
	children,
	fadeClass = "bg-[linear-gradient(to_top,var(--container-header-bg),transparent)]",
}: {
	lines: number;
	children: ReactNode;
	fadeClass?: string;
}) {
	const [expanded, setExpanded] = useState(false);

	if (lines <= THRESHOLD) return <>{children}</>;

	return (
		<div data-testid="collapsible" data-expanded={expanded} className="flex flex-col gap-4">
			<div className={expanded ? undefined : "relative max-h-384 overflow-hidden"}>
				{children}
				{expanded ? null : (
					<div className={`pointer-events-none absolute inset-x-0 bottom-0 h-32 ${fadeClass}`} />
				)}
			</div>
			<button
				type="button"
				data-testid="collapsible-toggle"
				onClick={() => setExpanded((e) => !e)}
				className="self-start text-primary tr-text-metadata hover:underline"
			>
				{expanded ? "Show less" : `Show all ${lines} lines`}
			</button>
		</div>
	);
}

export function countLines(text: string): number {
	if (!text) return 0;
	const n = text.split("\n").length;
	return text.endsWith("\n") ? n - 1 : n;
}
