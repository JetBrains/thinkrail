import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the one Tailwind form that fails silently. `font-[var(--font-mono)]` is an ambiguous
 * arbitrary value: Tailwind resolves `font-*` as a WEIGHT, emitting
 * `font-weight: var(--font-mono)` — invalid, dropped by the browser, so the element keeps the
 * inherited proportional face while the class list claims otherwise. It sat in 28 call sites
 * undetected (tool cards, keycaps, the header branch line, the brand wordmark).
 *
 * Components must not name a family at all: they use a generated semantic class (`tr-code-text`,
 * `tr-code-inline`, …). Where a family string is unavoidable — the mapping layers and the Monaco/xterm/
 * mermaid integrations — the working form is `font-(family-name:--…)` or the `--tr-font-family-*` token.
 */
const SRC = new URL("..", import.meta.url).pathname;
const BARE_FONT_VAR = /font-\[var\(--font-[a-z-]*\)\]/g;

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			out.push(...sourceFiles(path));
		} else if (/\.(tsx?|css)$/.test(entry) && !entry.endsWith(".test.ts")) {
			out.push(path);
		}
	}
	return out;
}

describe("font-family utilities", () => {
	it("never uses the bare font-[var(--font-*)] form (Tailwind compiles it to an invalid weight)", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(SRC)) {
			// index.css documents the trap by name; that mention is the point, not a usage.
			if (file.endsWith("index.css")) continue;
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(BARE_FONT_VAR)) {
				offenders.push(`${file.slice(SRC.length)}: ${match[0]}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
