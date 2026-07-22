/**
 * Reconstruct the OLD side of a unified diff from the NEW content + the patch, by reverse-applying
 * the patch's hunks. This is what lets `DiffPane` feed Monaco's two-sided diff editor from the wire's
 * existing surface (`git.diff` = a unified patch, `fs.readFile` = the new content) with no backend
 * change: old = reverseApplyPatch(patch, new).
 *
 * Handles the shapes `git diff` emits for the Changes list: modified (hunks), added/untracked
 * (all-`+` hunks → reconstructs to ""), deleted (all-`-` hunks over new content "" → the full old
 * file), and `\ No newline at end of file` markers on either side. A patch that doesn't apply
 * (malformed / drifted) returns `null` — the caller degrades rather than showing a wrong base.
 */
export function reverseApplyPatch(patch: string, newContent: string): string | null {
	if (patch.trim() === "") return newContent; // no textual change recorded → sides are identical

	// Split keeping line identity; a trailing "\n" yields a final "" entry we drop and re-add at the end.
	const endsWithNewline = newContent.endsWith("\n");
	const newLines = newContent === "" ? [] : newContent.split("\n");
	if (endsWithNewline) newLines.pop();

	const out: string[] = [];
	let newCursor = 0; // index into newLines of the next line not yet consumed
	let oldEndsWithoutNewline = false;
	let sawHunk = false;

	const lines = patch.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const header = lines[i];
		if (header === undefined || !header.startsWith("@@")) continue;
		const m = header.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
		if (!m) return null;
		sawHunk = true;
		// The hunk's position in the NEW file (1-based; ",0" ranges anchor after the given line).
		const newCount = m[2] === undefined ? 1 : Number(m[2]);
		const newStart = newCount === 0 ? Number(m[1]) : Number(m[1]) - 1;
		if (newStart < newCursor || newStart > newLines.length) return null;
		// Copy the untouched region before the hunk verbatim.
		out.push(...newLines.slice(newCursor, newStart));
		newCursor = newStart;

		// Replay the hunk: context + '-' lines belong to the old side; context + '+' consume new lines.
		let consumed = 0;
		for (i++; i < lines.length; i++) {
			const line = lines[i];
			if (line === undefined || line.startsWith("@@")) {
				i--;
				break;
			}
			const tag = line[0];
			if (tag === " " || tag === "-") out.push(line.slice(1));
			if (tag === " " || tag === "+") {
				if (newLines[newCursor + consumed] !== line.slice(1)) return null; // patch doesn't match content
				consumed++;
			}
			if (tag === "\\") {
				// "\ No newline at end of file" — applies to whichever side the previous line came from.
				const prev = lines[i - 1];
				if (prev?.[0] === "-" || prev?.[0] === " ") oldEndsWithoutNewline = true;
			}
			if (tag !== " " && tag !== "-" && tag !== "+" && tag !== "\\") break; // end of hunk body
		}
		if (consumed !== newCount) return null;
		newCursor += consumed;
	}
	if (!sawHunk) return null;

	out.push(...newLines.slice(newCursor));
	if (out.length === 0) return "";
	return out.join("\n") + (oldEndsWithoutNewline ? "" : "\n");
}
