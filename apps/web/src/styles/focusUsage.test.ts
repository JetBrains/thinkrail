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

const HAND_WRITTEN = /^!?-?(ring(?!-0$|-transparent$)(-|$)|outline-(?!none$|hidden$))/;

const handWrittenFocus = (token: string) => {
	const parts = splitVariants(token);
	const base = parts.pop() ?? "";
	return parts.some((v) => v.includes("focus")) && HAND_WRITTEN.test(base);
};

const SUPPRESSES_OUTLINE = (token: string) =>
	/^!?outline-(none|hidden)$/.test(splitVariants(token).pop() ?? "");
const DRAWS_FOCUS = (token: string) => {
	const parts = splitVariants(token);
	const base = parts.pop() ?? "";
	if (/^focus-ring(-|$)/.test(base)) return true;
	return (
		base.startsWith("bg-") &&
		parts.some((v) => /^(focus|focus-visible|data-\[selected=true\]|data-\[highlighted\])$/.test(v))
	);
};

const SUPPRESSION_DRAWN_ELSEWHERE: Record<string, { match: string; reason: string }[]> = {
	"chat/Composer.tsx": [
		{
			match: "absolute inset-0 size-full resize-none",
			reason: "the field frame draws has-[textarea:focus-visible]:focus-ring",
		},
	],
	"chat/ChatImage.tsx": [
		{ match: "relative inline-flex max-w-full", reason: "tabIndex=-1 programmatic target" },
	],
	"panels/PlanPane.tsx": [
		{
			match: "field-sizing-content max-h-[10rem]",
			reason: "the add-task frame draws has-[:focus-visible]:focus-ring",
		},
	],
	"shell/ProjectHome.tsx": [
		{ match: "flex min-h-0 flex-1 flex-col", reason: "tabIndex=-1 programmatic target" },
	],
	"shell/layout/workbenchTabs.tsx": [
		{
			match: "relative flex min-w-0 flex-1 items-center gap-4 self-stretch",
			reason: "the tab draws has-[[role=tab]:focus-visible]:focus-ring-inset-deep",
		},
	],
	"findInFiles/FindInFilesDialog.tsx": [
		{
			match: "h-full min-w-0 flex-1 bg-transparent tr-code-text",
			reason: "the window's only field: caret plus the active-descendant row",
		},
	],
	"search/SearchPalette.tsx": [
		{
			match: "h-full min-w-0 flex-1 bg-transparent tr-text-reading",
			reason: "the palette's only field: caret plus the active-descendant row",
		},
	],
	"packages/ui/command.tsx": [
		{
			match: "h-36 flex-1 bg-transparent",
			reason: "the list's only field: caret plus the selected item",
		},
	],
	"packages/ui/dialog.tsx": [
		{
			match: "flex flex-col border-border-default",
			reason: "dialog content: programmatic focus target",
		},
	],
	"packages/ui/popover.tsx": [
		{
			match: "z-50 overflow-hidden rounded-md",
			reason: "popover content: programmatic focus target",
		},
	],
	"thinkrail-extensions/ask-user-question/web/controls.tsx": [
		{
			match: "focus-visible:outline-none",
			reason: "the Other row draws has-[textarea:focus-visible]:focus-ring",
		},
	],
};

const CLASS_STRING = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;

function suppressedFocus(): { offenders: string[]; unused: string[] } {
	const offenders: string[] = [];
	const used = new Set<string>();
	for (const f of FILES) {
		if (f.endsWith(".css")) continue;
		const src = code(f);
		const label = designSourceLabel(f);
		for (const m of src.matchAll(CLASS_STRING)) {
			const tokens = (m[1] ?? m[2] ?? m[3] ?? "").split(/\s+/);
			if (!tokens.some(SUPPRESSES_OUTLINE) || tokens.some(DRAWS_FOCUS)) continue;
			const literal = tokens.join(" ");
			const excused = SUPPRESSION_DRAWN_ELSEWHERE[label]?.find((entry) =>
				literal.includes(entry.match),
			);
			if (excused) used.add(`${label} ${excused.match}`);
			else offenders.push(`${label}:${lineOf(src, m.index)} ${literal.trim()}`);
		}
	}
	const unused = Object.entries(SUPPRESSION_DRAWN_ELSEWHERE).flatMap(([label, entries]) =>
		entries.map((entry) => `${label} ${entry.match}`).filter((key) => !used.has(key)),
	);
	return { offenders, unused };
}

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

	it("never removes the focus outline unless another indicator draws focus", () => {
		const { offenders, unused } = suppressedFocus();
		expect(offenders).toEqual([]);
		expect(unused).toEqual([]);
	});

	it("tells an outline suppression with a replacement from one without", () => {
		expect(SUPPRESSES_OUTLINE("outline-none")).toBe(true);
		expect(SUPPRESSES_OUTLINE("focus-visible:outline-hidden")).toBe(true);
		expect(SUPPRESSES_OUTLINE("outline-offset-2")).toBe(false);
		for (const t of [
			"focus-visible:focus-ring",
			"has-[:focus-visible]:focus-ring-inset",
			"focus:bg-control-bg-selected",
			"data-[selected=true]:bg-control-bg-selected",
		])
			expect(DRAWS_FOCUS(t), t).toBe(true);
		for (const t of ["bg-control-bg-selected", "hover:bg-control-bg-hovered", "ring-1"])
			expect(DRAWS_FOCUS(t), t).toBe(false);
	});

	it("recognizes every hand-written focus indicator form", () => {
		for (const t of [
			"focus-visible:ring-2",
			"focus-visible:ring-inset",
			"focus-within:ring-1",
			"peer-focus-visible:ring-primary",
			"group-focus-visible:ring-2",
			"has-[:focus-visible]:ring-1",
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
			"has-[:focus-visible]:ring-0",
			"focus-within:ring-transparent",
			"focus-visible:opacity-100",
			"focus:bg-control-bg-selected",
			"data-[highlighted]:bg-control-bg-selected",
			"ring-1",
			"aria-invalid:ring-feedback-error",
		])
			expect(handWrittenFocus(t), t).toBe(false);
	});
});
