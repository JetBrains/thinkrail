import type { ReactNode } from "react";

export function highlightRanges(
	text: string,
	ranges: readonly (readonly [number, number])[] | undefined,
): ReactNode {
	if (!ranges || ranges.length === 0) return text;
	const parts: ReactNode[] = [];
	let cursor = 0;
	for (const [start, end] of ranges) {
		if (start > cursor) parts.push(text.slice(cursor, start));
		parts.push(
			<mark key={start} className="rounded-xs bg-primary-soft text-text-default">
				{text.slice(start, end)}
			</mark>,
		);
		cursor = end;
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return parts;
}
