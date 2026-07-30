import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Style, StyleRef, Typography } from "../../scripts/typography";
import {
	allStyles,
	CODE_STYLE_IDS,
	GENERATED_PATH,
	isRef,
	loadTypography,
	PROSE_SELECTORS,
	proseRootClassName,
	rawStyle,
	renderCss,
	resolveFamily,
	resolveStyle,
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

	it("holds 16 canonical definitions and 15 aliases (31 styles)", () => {
		const styles = allStyles(typography);
		expect(styles).toHaveLength(31);
		expect(styles.filter((s) => !s.ref)).toHaveLength(16);
		expect(styles.filter((s) => s.ref)).toHaveLength(15);
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
		expect(resolveFamily(typography, "interface").stack[0]).toBe("Geist Variable");
		expect(resolveFamily(typography, "code").stack[0]).toBe("JetBrains Mono Variable");
		// The brand family is an ALIAS of interface — the stack is never copied.
		expect(isRef(typography.fontFamilies.brand)).toBe(true);
		expect(resolveFamily(typography, "brand")).toEqual(resolveFamily(typography, "interface"));
		// One reading line-height: no 1.65 anywhere in the system.
		expect(Object.values(typography.lineHeights)).not.toContain(1.65);
	});

	it("keeps dialog title and card title identical — by reference, not by copy", () => {
		expect(rawStyle(typography, "title.card")).toEqual({ $ref: "title.dialog" });
		expect(resolveStyle(typography, "title.card")).toEqual(
			resolveStyle(typography, "title.dialog"),
		);
		expect(resolveStyle(typography, "title.dialog")).toMatchObject({
			fontSize: "s14",
			fontWeight: "semibold",
			lineHeight: "compact",
		});
	});

	it("restricts monospace to code styles", () => {
		for (const { id, style } of allStyles(typography)) {
			const isMono = resolveFamily(typography, style.fontFamily).kind === "monospace";
			expect(isMono, `${id} mono=${isMono}`).toBe(CODE_STYLE_IDS.has(id));
		}
		// The surfaces the mono policy names as proportional must be served by proportional styles.
		for (const id of ["ui.default", "ui.metadata", "ui.labelPill", "title.entity", "prose.body"]) {
			const style = resolveStyle(typography, id);
			expect(resolveFamily(typography, style.fontFamily).kind, id).toBe("proportional");
		}
	});

	it("expresses active state through colour, not weight (no style is heavier for being active)", () => {
		for (const name of Object.keys(typography.textStyles.ui)) {
			if (["action", "emphasis"].includes(name)) continue; // buttons + inline emphasis are 500 by policy
			const style = resolveStyle(typography, `ui.${name}`);
			expect(typography.fontWeights[style.fontWeight], `ui.${name}`).toBe(400);
		}
	});
});

describe("references", () => {
	/** A minimal valid document, so a case under test is the only thing that can fail. */
	function doc(
		styles: Record<string, Style | StyleRef>,
		prose: Record<string, Style | StyleRef> = {},
	) {
		const canonical: Style = {
			fontFamily: "interface",
			fontSize: "s12",
			fontWeight: "regular",
			lineHeight: "default",
			letterSpacing: "normal",
			textTransform: "none",
			fontStyle: "normal",
		};
		// The real `code` group stays, so the mono-only prose code styles have a canonical target.
		return {
			...typography,
			textStyles: { probe: { base: canonical, ...styles }, code: typography.textStyles.code },
			proseStyles: {
				...Object.fromEntries(
					Object.keys(PROSE_SELECTORS).map((id) => [
						id,
						{
							$ref:
								id === "inlineCode"
									? "code.inline"
									: id === "codeBlock"
										? "code.block"
										: "probe.base",
						},
					]),
				),
				...prose,
			},
		} as Typography;
	}
	const errorsFor = (t: Typography) => validate(t).filter((e) => !e.startsWith("title.card"));

	it("accepts a reference straight to a canonical definition", () => {
		expect(errorsFor(doc({ alias: { $ref: "probe.base" } }))).toEqual([]);
	});

	it("rejects a reference to another reference, naming the canonical target to use", () => {
		const errors = errorsFor(
			doc({ alias: { $ref: "probe.base" }, second: { $ref: "probe.alias" } }),
		);
		expect(errors).toContain(
			"probe.second references probe.alias, which is itself a reference. Reference probe.base directly.",
		);
	});

	it("rejects a missing reference target", () => {
		expect(errorsFor(doc({ alias: { $ref: "probe.nope" } }))).toContain(
			"probe.alias: $ref to unknown style 'probe.nope'",
		);
	});

	it("rejects a circular (self) reference", () => {
		expect(errorsFor(doc({ alias: { $ref: "probe.alias" } }))).toContain(
			"probe.alias: $ref points at itself",
		);
	});

	it("rejects a reference object carrying extra properties", () => {
		const errors = errorsFor(
			doc({ alias: { $ref: "probe.base", fontSize: "s14" } as unknown as StyleRef }),
		);
		expect(errors).toContain("probe.alias: a $ref may not carry other properties");
	});

	it("rejects two canonical definitions with identical values", () => {
		const twin = { ...resolveStyle(typography, "ui.default") };
		expect(errorsFor(doc({ twin }))).toContain(
			"probe.twin duplicates probe.base — identical canonical definitions must use a $ref",
		);
	});

	it("accepts separate aliases resolving to the same canonical definition", () => {
		expect(errorsFor(doc({ one: { $ref: "probe.base" }, two: { $ref: "probe.base" } }))).toEqual(
			[],
		);
	});

	it("holds no chained or duplicated references in the real source", () => {
		for (const { id, ref } of allStyles(typography)) {
			if (!ref) continue;
			const target = rawStyle(typography, ref);
			expect(target, `${id} → ${ref}`).toBeDefined();
			expect(isRef(target), `${id} → ${ref} must be a canonical definition`).toBe(false);
		}
		for (const id of Object.keys(typography.fontFamilies)) {
			const entry = typography.fontFamilies[id];
			if (!isRef(entry)) continue;
			expect(isRef(typography.fontFamilies[entry.$ref]), `fontFamilies.${id}`).toBe(false);
		}
	});

	it("resolves every reference to its target's values in one hop", () => {
		for (const { id, style, ref } of allStyles(typography)) {
			if (!ref) continue;
			expect(style, `${id} → ${ref}`).toEqual(resolveStyle(typography, ref));
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

	it("styles prose <strong> with weight ALONE, so bold inherits its parent's typography", () => {
		const root = proseRootClassName(typography);
		const block = new RegExp(`\\.${root} :is\\(strong, b\\) \\{([^}]*)\\}`).exec(GENERATED);
		expect(block, "the weight-only strong rule is missing").not.toBeNull();
		const declarations = (block?.[1] ?? "")
			.split(";")
			.map((d) => d.trim())
			.filter(Boolean);
		expect(declarations).toEqual([`font-weight: var(${"--tr-font-weight-medium"})`]);
		// A complete style here would override the size/line-height of the heading or cell it sits in.
		expect(typography.proseStyles).not.toHaveProperty("strong");
		expect(PROSE_SELECTORS).not.toHaveProperty("strong");
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
