import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { designSourceFiles, designSourceLabel } from "../../scripts/designSources";
import { normalizeEol } from "../../scripts/generatedFiles";

const code = (path: string) =>
	normalizeEol(readFileSync(path, "utf8"))
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
const FILES = designSourceFiles();
const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length;

const splitVariants = (token: string) => {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < token.length; i++) {
		const ch = token[i];
		if (ch === "[") depth++;
		else if (ch === "]") depth--;
		else if (ch === ":" && depth === 0) {
			parts.push(token.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(token.slice(start));
	return parts;
};

const HAND_WRITTEN = /^!?-?(ring(-|$)|outline-(?!none$|hidden$))/;

const handWrittenFocus = (token: string) => {
	const parts = splitVariants(token);
	const base = parts.pop() ?? "";
	return parts.some((v) => v.includes("focus")) && HAND_WRITTEN.test(base);
};

const FOCUS_RULE = /([^{}]*:focus[^{}]*)\{([^{}]*)\}/g;
const CSS_INDICATOR =
	/(^|;)\s*(outline\s*:\s*(?!none\s*(;|$))|outline-(width|color|style|offset)\s*:|box-shadow\s*:)/;

describe("focus indicator adoption", () => {
	it("draws keyboard focus only with the shared focus-ring utilities", () => {
		const bad: string[] = [];
		for (const f of FILES) {
			const src = code(f);
			const label = designSourceLabel(f);
			for (const m of src.matchAll(/[^\s"'`{}(),]+/g))
				if (handWrittenFocus(m[0])) bad.push(`${label}:${lineOf(src, m.index)} ${m[0]}`);
			if (!f.endsWith(".css")) continue;
			for (const m of src.matchAll(FOCUS_RULE)) {
				const body = m[2] ?? "";
				const applied = [...body.matchAll(/@apply([^;]*)/g)].flatMap((a) =>
					(a[1] ?? "").trim().split(/\s+/),
				);
				if (CSS_INDICATOR.test(body) || applied.some((t) => HAND_WRITTEN.test(t)))
					bad.push(`${label}:${lineOf(src, m.index)} ${(m[1] ?? "").trim()}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it("recognizes every hand-written focus indicator form", () => {
		for (const t of [
			"focus-visible:ring-2",
			"focus-visible:ring-inset",
			"focus-within:ring-1",
			"peer-focus-visible:ring-primary",
			"group-focus-visible:ring-2",
			"has-[:focus-visible]:ring-0",
			"focus-visible:outline-2",
			"focus-visible:outline-primary",
			"focus-visible:-outline-offset-2",
			"focus:outline-ring",
		])
			expect(handWrittenFocus(t), t).toBe(true);
		for (const t of [
			"focus-visible:focus-ring",
			"has-[:focus-visible]:focus-ring",
			"focus-visible:outline-none",
			"focus-visible:opacity-100",
			"focus:bg-control-bg-selected",
			"data-[highlighted]:bg-control-bg-selected",
			"ring-1",
			"aria-invalid:ring-feedback-error",
		])
			expect(handWrittenFocus(t), t).toBe(false);
	});
});
