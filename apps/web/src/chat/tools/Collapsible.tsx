import { type ReactNode, useState } from "react";

const THRESHOLD = 24;

/**
 * Clips tall tool output (read/write content, edit diffs) beyond ~{@link THRESHOLD} lines behind a fade
 * and a "Show all N lines" toggle; short output renders untouched. State is local, so it survives the
 * card's streaming re-renders. `fadeClass` is a token-var gradient matching the content's background so
 * the fade is themeable. Presentational — no store/transport.
 */
export function Collapsible({
	lines,
	children,
	fadeClass = "bg-[linear-gradient(to_top,var(--bg-dark),transparent)]",
}: {
	lines: number;
	children: ReactNode;
	fadeClass?: string;
}) {
	const [expanded, setExpanded] = useState(false);

	if (lines <= THRESHOLD) return <>{children}</>;

	return (
		<div data-testid="collapsible" data-expanded={expanded} className="flex flex-col gap-xs">
			<div className={expanded ? undefined : "relative max-h-96 overflow-hidden"}>
				{children}
				{expanded ? null : (
					<div className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 ${fadeClass}`} />
				)}
			</div>
			<button
				type="button"
				data-testid="collapsible-toggle"
				onClick={() => setExpanded((e) => !e)}
				className="self-start text-primary text-xs hover:underline"
			>
				{expanded ? "Show less" : `Show all ${lines} lines`}
			</button>
		</div>
	);
}

/** Line count of a block of text ("" → 0); a single trailing newline doesn't count as an extra line. */
export function countLines(text: string): number {
	if (!text) return 0;
	const n = text.split("\n").length;
	return text.endsWith("\n") ? n - 1 : n;
}
