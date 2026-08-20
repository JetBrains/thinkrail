import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
			if (file.endsWith("index.css")) continue;
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(BARE_FONT_VAR)) {
				offenders.push(`${file.slice(SRC.length)}: ${match[0]}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
