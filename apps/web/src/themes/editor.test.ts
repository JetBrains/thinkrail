import { expect, test } from "bun:test";
import { SYNTAX_VARIABLES } from "@thinkrail/design-tokens";
import { cssColorToHex } from "@/lib";
import { resolveThinkrailEditorTheme, THINKRAIL_MONACO_COLOR_VARIABLES } from "./editor";

const PALETTE = new Map(
	[...Object.values(SYNTAX_VARIABLES), ...Object.values(THINKRAIL_MONACO_COLOR_VARIABLES)].map(
		(variable, index) => [variable, `#${(index + 1).toString(16).padStart(6, "0")}`],
	),
);

function resolve(readVariable = (name: string) => PALETTE.get(name) ?? "") {
	return resolveThinkrailEditorTheme({ readVariable, toHex: cssColorToHex });
}

function foreground(token: string) {
	return resolve().rules.find((rule) => rule.token === token)?.foreground;
}

function hexOf(variable: string) {
	return PALETTE.get(variable)?.slice(1);
}

test("every token rule reads a semantic syntax variable as bare hex", () => {
	const known = new Set([...PALETTE.values()].map((color) => color.slice(1)));
	const { rules } = resolve();
	expect(rules.length).toBeGreaterThan(0);
	for (const rule of rules) expect(known.has(rule.foreground)).toBe(true);
	expect(JSON.stringify(rules)).not.toContain("var(");
});

test("the base rules match the chat colors for each Pierre token", () => {
	expect(foreground("")).toBe(hexOf("--code-foreground"));
	expect(foreground("keyword")).toBe(hexOf("--code-keyword"));
	expect(foreground("keyword.operator")).toBe(hexOf("--code-operator"));
	expect(foreground("comment.doc")).toBe(hexOf("--code-comment-doc"));
});

test("Markdown emphasis drops the italic of Monaco's base theme, as in chat and diffs", () => {
	const emphasis = resolve().rules.find((rule) => rule.token === "emphasis");
	expect(emphasis?.foreground).toBe(foreground(""));
	expect(emphasis).toMatchObject({ fontStyle: "" });
});

test("every Monaco UI color resolves to hex", () => {
	const { colors } = resolve();
	for (const [key, variable] of Object.entries(THINKRAIL_MONACO_COLOR_VARIABLES)) {
		expect(colors[key]).toBe(PALETTE.get(variable) ?? "");
	}
});

test("a missing variable drops its rule and color so Monaco's base stays usable", () => {
	const { rules, colors } = resolve((name) =>
		name === "--code-keyword" || name === "--primary" ? "" : (PALETTE.get(name) ?? ""),
	);
	expect(rules.find((rule) => rule.token === "keyword")).toBeUndefined();
	expect(colors.focusBorder).toBeUndefined();
});
