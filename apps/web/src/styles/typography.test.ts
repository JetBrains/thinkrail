import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	allStyles,
	CODE_STYLE_IDS,
	GENERATED_PATH,
	loadTypography,
	PROSE_SELECTORS,
	proseRootClassName,
	renderCss,
	styleClassName,
	validate,
} from "../../scripts/typography";

/**
 * The typography system's guard rail. `typography.json` is the only source of typography values, so
 * these tests pin (a) the source's integrity, (b) that the committed generated CSS matches it, and
 * (c) that components cannot reintroduce the patterns the system replaced.
 */

const typography = loadTypography();
const SRC = new URL("..", import.meta.url).pathname;
const GENERATED = readFileSync(GENERATED_PATH, "utf8");

const read = (p: string) => readFileSync(p, "utf8");

describe("typography source", () => {
	it("is valid: schema shape, references, ids, full resolution, mono policy", () => {
		expect(validate(typography)).toEqual([]);
	});

	it("resolves every semantic style to all seven properties", () => {
		for (const { id, style } of allStyles(typography)) {
			expect(typography.fontFamilies[style.fontFamily], `${id} family`).toBeDefined();
			expect(typography.fontSizes[style.fontSize], `${id} size`).toBeDefined();
			expect(typography.fontWeights[style.fontWeight], `${id} weight`).toBeDefined();
			expect(typography.lineHeights[style.lineHeight], `${id} line-height`).toBeDefined();
			expect(typography.letterSpacings[style.letterSpacing], `${id} letter-spacing`).toBeDefined();
			expect(style.textTransform, `${id} transform`).toBeString();
			expect(style.fontStyle, `${id} style`).toBeString();
		}
	});

	it("pins the primitive token values", () => {
		expect(typography.fontSizes).toEqual({
			s10: 10,
			s11: 11,
			s12: 12,
			s13: 13,
			s14: 14,
			s18: 18,
			s44: 44,
		});
		expect(typography.lineHeights).toEqual({ compact: 1.25, code: 1.5, default: 1.6 });
		expect(typography.fontWeights).toEqual({
			regular: 400,
			medium: 500,
			semibold: 600,
			brand: 800,
		});
		expect(typography.fontFamilies.interface.stack[0]).toBe("Geist Variable");
		expect(typography.fontFamilies.code.stack[0]).toBe("JetBrains Mono Variable");
		// One reading line-height: no 1.65 anywhere in the system.
		expect(Object.values(typography.lineHeights)).not.toContain(1.65);
	});

	it("keeps dialog title and card title identical", () => {
		expect(typography.textStyles.title.card).toEqual(typography.textStyles.title.dialog);
		expect(typography.textStyles.title.dialog).toMatchObject({
			fontSize: "s14",
			fontWeight: "semibold",
			lineHeight: "compact",
		});
	});

	it("restricts monospace to code styles", () => {
		for (const { id, style } of allStyles(typography)) {
			const isMono = typography.fontFamilies[style.fontFamily].kind === "monospace";
			expect(isMono, `${id} mono=${isMono}`).toBe(CODE_STYLE_IDS.has(id));
		}
		// The surfaces the mono policy names as proportional must be served by proportional styles.
		for (const id of ["ui.entity", "ui.metadata", "ui.labelPill", "ui.status", "title.entity"]) {
			const [group, name] = id.split(".");
			const style = typography.textStyles[group][name];
			expect(typography.fontFamilies[style.fontFamily].kind, id).toBe("proportional");
		}
	});

	it("expresses active state through colour, not weight (no style is heavier for being active)", () => {
		for (const [name, style] of Object.entries(typography.textStyles.ui)) {
			if (["action", "emphasis"].includes(name)) continue; // buttons + inline emphasis are 500 by policy
			expect(typography.fontWeights[style.fontWeight], `ui.${name}`).toBe(400);
		}
	});
});

describe("generated CSS", () => {
	it("is up to date with the source", () => {
		expect(GENERATED).toBe(renderCss(typography));
	});

	it("emits a class for every semantic style, with all seven declarations", () => {
		for (const { group, name } of allStyles(typography)) {
			if (group === "prose") continue;
			const cls = styleClassName(typography, group, name);
			const block = new RegExp(`\\.${cls} \\{([^}]*)\\}`).exec(GENERATED);
			expect(block, `.${cls} missing`).not.toBeNull();
			for (const prop of [
				"font-family",
				"font-size",
				"font-weight",
				"line-height",
				"letter-spacing",
				"text-transform",
				"font-style",
			])
				expect(block?.[1], `.${cls} ${prop}`).toContain(`${prop}:`);
		}
	});

	it("emits the shared prose system as one class with element selectors", () => {
		const root = proseRootClassName(typography);
		expect(GENERATED).toContain(`.${root} {`);
		for (const [id, selector] of Object.entries(PROSE_SELECTORS))
			expect(GENERATED, `prose ${id}`).toContain(`.${root}${selector} {`);
	});

	it("exposes the code family + size tokens Monaco and xterm read", () => {
		expect(GENERATED).toContain("--tr-font-family-code:");
		expect(GENERATED).toContain("--tr-font-size-s11: 11px;");
		expect(GENERATED).toContain("--tr-line-height-default: 1.6;");
		const monaco = read(join(SRC, "panels/monacoSetup.ts"));
		const xterm = read(join(SRC, "panels/TerminalInstance.tsx"));
		for (const file of [monaco, xterm]) {
			expect(file).toContain('cssVar("--tr-font-size-s11")');
			expect(file).toContain('cssVar("--tr-font-family-code")');
		}
		expect(monaco).toContain('cssVar("--tr-line-height-default")');
	});
});
