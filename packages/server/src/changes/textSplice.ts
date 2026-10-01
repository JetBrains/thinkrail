import type { LineSpan } from "@thinkrail/contracts";

export function splitLines(text: string): string[] {
	const segments: string[] = [];
	let start = 0;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "\n") {
			segments.push(text.slice(start, index + 1));
			start = index + 1;
			continue;
		}
		if (char !== "\r") continue;
		const end = text[index + 1] === "\n" ? index + 2 : index + 1;
		segments.push(text.slice(start, end));
		index = end - 1;
		start = end;
	}
	if (start < text.length) segments.push(text.slice(start));
	return segments;
}

export function spanFits(span: LineSpan, lines: number): boolean {
	if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.count)) return false;
	if (span.start < 1 || span.count < 0) return false;
	return span.count === 0 ? span.start <= lines + 1 : span.start + span.count - 1 <= lines;
}

function ending(segment: string | undefined): string | null {
	if (segment?.endsWith("\r\n")) return "\r\n";
	if (segment?.endsWith("\n")) return "\n";
	if (segment?.endsWith("\r")) return "\r";
	return null;
}

function terminated(segment: string | undefined): boolean {
	return ending(segment) !== null;
}

function endsAtTail(span: LineSpan, lines: number): boolean {
	return span.start + span.count - 1 === lines;
}

function dominantEol(segments: readonly string[]): string | null {
	let crlf = 0;
	let lf = 0;
	let cr = 0;
	for (const segment of segments) {
		if (segment.endsWith("\r\n")) crlf++;
		else if (segment.endsWith("\n")) lf++;
		else if (segment.endsWith("\r")) cr++;
	}
	if (crlf === 0 && lf === 0 && cr === 0) return null;
	if (crlf >= lf && crlf >= cr) return "\r\n";
	return lf >= cr ? "\n" : "\r";
}

export function revertedText(
	original: readonly string[],
	modified: readonly string[],
	target: { original: LineSpan; modified: LineSpan },
): string {
	const from = target.original.start - 1;
	const segments = [...modified];
	segments.splice(
		target.modified.start - 1,
		target.modified.count,
		...original.slice(from, from + target.original.count),
	);
	const eol = dominantEol(modified) ?? dominantEol(original) ?? "\n";
	for (let index = 0; index < segments.length - 1; index++) {
		const segment = segments[index] ?? "";
		if (!terminated(segment)) segments[index] = segment + eol;
	}
	const last = segments.length - 1;
	const tail = segments[last];
	const bothSpansReachTail =
		endsAtTail(target.modified, modified.length) && endsAtTail(target.original, original.length);
	const finalStateSource = bothSpansReachTail
		? original[original.length - 1]
		: modified[modified.length - 1];
	const finalEnding = ending(finalStateSource);
	if (tail !== undefined) {
		if (finalEnding !== null && !terminated(tail)) segments[last] = tail + finalEnding;
		if (finalEnding === null && terminated(tail)) {
			segments[last] = tail.replace(/\r\n$|[\n\r]$/, "");
		}
	}
	return segments.join("");
}
