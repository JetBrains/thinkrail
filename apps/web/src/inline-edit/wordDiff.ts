/** One span of the word-level diff between two strings. Concatenating `text` in order over `same`+`add`
 * reproduces the new text; over `same`+`del` reproduces the old text. */
export interface DiffPart {
	kind: "same" | "del" | "add";
	text: string;
}

/** Split into tokens that keep trailing whitespace, so parts re-join into the exact original strings. */
function tokenize(s: string): string[] {
	return s.match(/\S+\s*|\s+/g) ?? [];
}

/**
 * Word-level diff via a classic LCS table. Small inputs only (a selection-sized hunk), so O(n·m) is fine.
 * Adjacent parts of the same kind are merged so the rendered view has minimal spans.
 */
export function wordDiff(oldText: string, newText: string): DiffPart[] {
	const a = tokenize(oldText);
	const b = tokenize(newText);
	const n = a.length;
	const m = b.length;
	const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i -= 1) {
		for (let j = m - 1; j >= 0; j -= 1) {
			const aToken = a[i];
			const bToken = b[j];
			if (aToken !== undefined && bToken !== undefined) {
				const nextDiag = (lcs[i + 1]?.[j + 1] ?? 0) as number;
				const nextDown = (lcs[i + 1]?.[j] ?? 0) as number;
				const nextRight = (lcs[i]?.[j + 1] ?? 0) as number;
				const row = lcs[i] as number[];
				row[j] = aToken === bToken ? nextDiag + 1 : Math.max(nextDown, nextRight);
			}
		}
	}
	const parts: DiffPart[] = [];
	const push = (kind: DiffPart["kind"], text: string) => {
		const last = parts[parts.length - 1];
		if (last && last.kind === kind) last.text += text;
		else parts.push({ kind, text });
	};
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		const aToken = a[i];
		const bToken = b[j];
		if (aToken !== undefined && bToken !== undefined) {
			const lcsDown = (lcs[i + 1]?.[j] ?? 0) as number;
			const lcsRight = (lcs[i]?.[j + 1] ?? 0) as number;
			if (aToken === bToken) {
				push("same", aToken);
				i += 1;
				j += 1;
			} else if (lcsDown >= lcsRight) {
				push("del", aToken);
				i += 1;
			} else {
				push("add", bToken);
				j += 1;
			}
		} else {
			break;
		}
	}
	while (i < n) {
		const aToken = a[i];
		if (aToken !== undefined) {
			push("del", aToken);
		}
		i += 1;
	}
	while (j < m) {
		const bToken = b[j];
		if (bToken !== undefined) {
			push("add", bToken);
		}
		j += 1;
	}
	return parts;
}
