/**
 * Terminal contrast integration for xterm — the accessibility floor and the dim-attribute handling that
 * xterm's own `minimumContrastRatio` cannot cover on its own.
 *
 * Kept as a pure module (no DOM, no xterm import) so the contrast gate (`terminalContrast.test.ts`) can
 * exercise it directly, and so the numbers the terminal is configured with live in one place.
 */

const ESC = String.fromCharCode(27);
/** Complete `CSI <params> m` (SGR) sequences only. A sequence split across write chunks stays intact —
 *  it simply isn't rewritten that once, which is safe (never corrupt), rather than buffered. */
const SGR_SEQUENCE = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

/**
 * xterm's per-cell `minimumContrastRatio`. High-contrast themes target WCAG **AAA (7:1)**; the rest target
 * **AA (4.5:1)**. Correction always lifts a foreground to this floor against the live background, so no
 * `--ansi-*` palette value can render below it. (xterm halves the ratio for DIM cells — but in HC we drop
 * the dim attribute entirely via `stripAnsiDim`, so this floor governs the cells that actually render.)
 */
export function terminalContrastFloor(isHighContrast: boolean): number {
	return isHighContrast ? 7 : 4.5;
}

/**
 * Drop the ANSI **dim** parameter (SGR `2`) from one SGR parameter list, preserving everything else —
 * critically the `2` inside a `38;2;r;g;b` / `48;2;r;g;b` truecolor introducer, which selects RGB, not dim.
 */
function filterDimSgrParams(params: string): string {
	const parts = params.split(";");
	const kept: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === undefined) continue;
		if (part === "38" || part === "48") {
			// An extended-colour introducer: copy it and its sub-parameters verbatim (`2`/`5` are the
			// colour MODE here, and truecolor's `2` must never be read as the dim attribute).
			kept.push(part);
			const mode = parts[i + 1];
			if (mode === undefined) continue;
			kept.push(mode);
			i += 1;
			const subCount = mode === "2" ? 3 : mode === "5" ? 1 : 0;
			for (let k = 0; k < subCount; k++) {
				const sub = parts[i + 1];
				if (sub === undefined) break;
				kept.push(sub);
				i += 1;
			}
			continue;
		}
		if (part === "2") continue; // the dim attribute — the only parameter we remove
		kept.push(part);
	}
	return kept.join(";");
}

/**
 * Remove the ANSI **dim** attribute (SGR 2) from a terminal output chunk.
 *
 * xterm renders dim as the foreground at 50% opacity, which on a light background caps around **3.3:1** —
 * below WCAG AA — no matter how high `minimumContrastRatio` is set: correction never fires for the
 * already-high-contrast default foreground (e.g. Vite's dim `(client)` tag, which is dim over the DEFAULT
 * foreground, not an ansi colour). Dropping the attribute makes that text render at full foreground
 * contrast instead. Only used for the high-contrast themes, at the terminal's output boundary.
 */
export function stripAnsiDim(data: string): string {
	return data.replace(SGR_SEQUENCE, (full, params: string) => {
		const kept = filterDimSgrParams(params);
		if (kept === params) return full; // nothing dropped (incl. the bare `CSI m` reset, params === "")
		if (kept === "") return ""; // the sequence was ONLY dim → drop it, never emit a `CSI m` reset
		return `${ESC}[${kept}m`;
	});
}
