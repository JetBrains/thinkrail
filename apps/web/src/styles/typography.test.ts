import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeEol } from "../../scripts/generatedFiles";
import type { Style, StyleRef, Typography } from "../../scripts/typography";
import {
	allStyles,
	GENERATED_PATH,
	isCodeStyleId,
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
 * (c) the policies that cannot be read off the JSON — mono is code-only, the document ladder never
 * inverts, `<body>` names a semantic style rather than repeating one.
 */

const typography = loadTypography();
const SRC = new URL("..", import.meta.url).pathname;
const GENERATED = normalizeEol(readFileSync(GENERATED_PATH, "utf8"));

const read = (p: string) => readFileSync(p, "utf8");
const px = (id: string) => typography.fontSizes[resolveStyle(typography, id).fontSize];

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

	it("holds 20 canonical definitions and 30 aliases (50 styles)", () => {
		const styles = allStyles(typography);
		expect(styles).toHaveLength(50);
		expect(styles.filter((s) => !s.ref)).toHaveLength(20);
		expect(styles.filter((s) => s.ref)).toHaveLength(30);
		// Both markdown surfaces are almost entirely aliases — that is the point of the reference
		// mechanism: two scales, one set of underlying definitions.
		expect(styles.filter((s) => s.prose)).toHaveLength(28);
	});

	it("pins the primitive token values", () => {
		expect(typography.fontSizes).toEqual({
			s10: 10,
			s11: 11,
			s12: 12,
			s13: 13,
			s14: 14,
			s16: 16,
			s18: 18,
			s20: 20,
			s24: 24,
			s44: 44,
		});
		expect(typography.lineHeights).toEqual({
			compact: 1.25,
			metadata: 1.3333333,
			ui: 1.4285714,
			code: 1.5,
			relaxed: 1.5384615,
			default: 1.6,
		});
		expect(typography.fontWeights).toEqual({
			light: 370,
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

	/**
	 * The `<body>` fallback is a `$ref`, never values. If it held its own numbers, unclassed text would
	 * render at a size no semantic style names — which is how a broken class name goes unnoticed.
	 */
	it("names a semantic style for the document base instead of repeating one", () => {
		expect(isRef(typography.rootStyle)).toBe(true);
		expect(typography.rootStyle.$ref).toBe("ui.default");
		const target = rawStyle(typography, typography.rootStyle.$ref);
		expect(isRef(target), "rootStyle must point at a canonical definition").toBe(false);
		expect(resolveStyle(typography, typography.rootStyle.$ref)).toEqual(
			resolveStyle(typography, "ui.default"),
		);
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
			expect(isMono, `${id} mono=${isMono}`).toBe(isCodeStyleId(typography, id));
		}
		// The surfaces the mono policy names as proportional must be served by proportional styles.
		for (const id of [
			"ui.default",
			"ui.metadata",
			"ui.labelPill",
			"title.entity",
			"chat.body",
			"doc.body",
		]) {
			const style = resolveStyle(typography, id);
			expect(resolveFamily(typography, style.fontFamily).kind, id).toBe("proportional");
		}
	});

	it("keeps state out of typography and pins the UI role weights", () => {
		expect(
			Object.fromEntries(
				Object.keys(typography.textStyles.ui).map((name) => {
					const style = resolveStyle(typography, `ui.${name}`);
					return [name, typography.fontWeights[style.fontWeight]];
				}),
			),
		).toEqual({
			default: 370,
			metadata: 370,
			eyebrow: 500,
			labelPill: 500,
			action: 500,
			emphasis: 500,
		});
	});

	/** The shared heading scale both markdown surfaces draw from, largest to smallest, no gaps. */
	it("holds one monotonic heading scale", () => {
		expect(Object.keys(typography.textStyles.heading)).toEqual(["xl", "lg", "md", "sm"]);
		const sizes = ["xl", "lg", "md", "sm"].map((n) => px(`heading.${n}`) as number);
		expect(sizes).toEqual([24, 20, 18, 16]);
		for (const n of ["xl", "lg", "md", "sm"])
			expect(resolveStyle(typography, `heading.${n}`), `heading.${n}`).toMatchObject({
				fontWeight: "semibold",
				lineHeight: "compact",
			});
	});
});

describe("prose systems", () => {
	it("gives every surface the same element set", () => {
		const systems = Object.keys(typography.proseSystems);
		expect(systems).toEqual(["chat", "doc"]);
		for (const system of systems)
			expect(Object.keys(typography.proseSystems[system] ?? {}).sort(), system).toEqual(
				Object.keys(PROSE_SELECTORS).sort(),
			);
	});

	it("keeps the chat scale compact — a bubble, not a document", () => {
		expect(px("chat.body")).toBe(14);
		expect(px("chat.h1")).toBe(18);
		expect(px("chat.h2")).toBe(14);
		expect(px("chat.h3")).toBe(12);
		expect(px("chat.codeBlock")).toBe(13);
	});

	/**
	 * The reason `doc` exists. A rendered README has to read as a document: h1–h4 visibly larger than
	 * its paragraphs, and the ladder monotonic all the way down. The chat scale (h2 == body, h3–h5
	 * below it) is correct in a bubble and wrong here.
	 */
	it("gives the document scale headings larger than its body text", () => {
		const body = px("doc.body") as number;
		expect(body).toBe(14);
		expect(["h1", "h2", "h3", "h4"].map((h) => px(`doc.${h}`))).toEqual([24, 20, 18, 16]);
		for (const h of ["h1", "h2", "h3", "h4"])
			expect(px(`doc.${h}`), `doc.${h} > body`).toBeGreaterThan(body);
		const ladder = ["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => px(`doc.${h}`) as number);
		for (let i = 1; i < ladder.length; i++)
			expect(ladder[i], `doc.h${i + 1} <= doc.h${i}`).toBeLessThanOrEqual(ladder[i - 1] as number);
		// h5/h6 carry weight and transform instead of size, the convention markdown renderers settle on.
		expect(resolveStyle(typography, "doc.h5")).toMatchObject({ fontWeight: "semibold" });
		expect(resolveStyle(typography, "doc.h6")).toMatchObject({
			fontWeight: "semibold",
			textTransform: "uppercase",
		});
		// Chat and document fenced code share the current 13px size; document code is never smaller.
		expect(px("doc.codeBlock")).toBe(13);
		expect(px("doc.codeBlock")).toBeGreaterThanOrEqual(px("chat.codeBlock") as number);
	});

	it("shares its canonical definitions across both surfaces", () => {
		// The same 18/600 heading serves the chat h1 and the document h3 — one definition, two roles.
		expect(resolveStyle(typography, "chat.h1")).toEqual(resolveStyle(typography, "doc.h3"));
		expect(rawStyle(typography, "chat.h1")).toEqual({ $ref: "heading.md" });
		expect(rawStyle(typography, "doc.h3")).toEqual({ $ref: "heading.md" });
		// Body copy is one definition everywhere.
		for (const id of ["chat.body", "doc.body", "chat.blockquote", "doc.list", "title.entity"])
			expect(resolveStyle(typography, id), id).toEqual(resolveStyle(typography, "body.reading"));
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
			rootStyle: { $ref: "probe.base" },
			textStyles: { probe: { base: canonical, ...styles }, code: typography.textStyles.code },
			proseSystems: {
				chat: {
					...Object.fromEntries(
						Object.keys(PROSE_SELECTORS).map((id) => [
							id,
							{
								$ref:
									id === "inlineCode" || id === "codeBlock" || id === "tableInlineCode"
										? "code.text"
										: "probe.base",
							},
						]),
					),
					...prose,
				},
			},
		} as unknown as Typography;
	}
	/** The real source's policy checks (card title, the `doc` ladder) don't apply to a probe document. */
	const errorsFor = (t: Typography) =>
		validate(t).filter((e) => !e.startsWith("title.card") && !e.startsWith("doc."));

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
		const twin: Style = {
			fontFamily: "interface",
			fontSize: "s12",
			fontWeight: "regular",
			lineHeight: "default",
			letterSpacing: "normal",
			textTransform: "none",
			fontStyle: "normal",
		};
		expect(errorsFor(doc({ twin }))).toContain(
			"probe.twin duplicates probe.base — identical canonical definitions must use a $ref",
		);
	});

	it("accepts separate aliases resolving to the same canonical definition", () => {
		expect(errorsFor(doc({ one: { $ref: "probe.base" }, two: { $ref: "probe.base" } }))).toEqual(
			[],
		);
	});

	it("rejects a rootStyle that carries its own values", () => {
		const t = { ...doc({}), rootStyle: resolveStyle(typography, "ui.default") } as Typography;
		expect(errorsFor(t)).toContain(
			"rootStyle must be a $ref to a semantic style, not a set of values",
		);
	});

	it("rejects a prose system missing an element from the shared set", () => {
		const t = doc({});
		delete (t.proseSystems.chat as Record<string, unknown>).blockquote;
		expect(errorsFor(t)).toContain(
			"proseSystems.chat.blockquote: missing (the element set is fixed)",
		);
	});

	it("rejects a prose system id that collides with a textStyles group", () => {
		const t = doc({});
		t.proseSystems.probe = t.proseSystems.chat as Record<string, Style | StyleRef>;
		expect(errorsFor(t)).toContain(
			"'probe' is both a textStyles group and a prose system — group names must be distinct",
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

	it("emits the document base in @layer base, so any semantic class outranks it", () => {
		const baseLayer = GENERATED.indexOf("@layer base {");
		const componentLayer = GENERATED.indexOf("@layer components {");
		expect(baseLayer).toBeGreaterThan(-1);
		expect(baseLayer).toBeLessThan(componentLayer);
		const block = /@layer base \{\s*body \{([^}]*)\}/.exec(GENERATED);
		expect(block, "the body base rule is missing").not.toBeNull();
		// It carries the rootStyle target's values, not values of its own.
		const root = resolveStyle(typography, typography.rootStyle.$ref);
		expect(block?.[1]).toContain(`--tr-font-size-${root.fontSize}`);
		expect(block?.[1]).toContain(`--tr-font-weight-${root.fontWeight}`);
	});

	it("emits the semantic classes inside @layer components, so utilities can override them", () => {
		// Unlayered CSS outranks every @layer, which would make `italic` / `leading-*` at a call site
		// lose to the semantic declarations. Tailwind orders theme < base < components < utilities.
		const layerStart = GENERATED.indexOf("@layer components {");
		expect(layerStart, "the semantic classes must be layered").toBeGreaterThan(-1);
		// Tokens stay unlayered: custom properties have nothing to compete with.
		expect(GENERATED.indexOf(":root {")).toBeLessThan(layerStart);
		for (const { group, name, prose } of allStyles(typography)) {
			if (prose) continue;
			const cls = `.${styleClassName(typography, group, name)} {`;
			expect(GENERATED.indexOf(cls), `${cls} must sit inside the layer`).toBeGreaterThan(
				layerStart,
			);
		}
		for (const system of Object.keys(typography.proseSystems))
			expect(GENERATED.indexOf(`.${proseRootClassName(typography, system)} {`)).toBeGreaterThan(
				layerStart,
			);
		// The layer block closes exactly once at the end.
		expect(GENERATED.trimEnd().endsWith("}\n}")).toBe(true);
		expect(GENERATED.split("{").length).toBe(GENERATED.split("}").length);
	});

	it("emits a class for every semantic style, with all seven declarations", () => {
		for (const { group, name, prose } of allStyles(typography)) {
			if (prose) continue;
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

	it("styles prose <strong> with weight ALONE in every system, so bold inherits its parent", () => {
		for (const system of Object.keys(typography.proseSystems)) {
			const root = proseRootClassName(typography, system);
			const block = new RegExp(`\\.${root} :is\\(strong, b\\) \\{([^}]*)\\}`).exec(GENERATED);
			expect(block, `${system}: the weight-only strong rule is missing`).not.toBeNull();
			const declarations = (block?.[1] ?? "")
				.split(";")
				.map((d) => d.trim())
				.filter(Boolean);
			expect(declarations, system).toEqual(["font-weight: var(--tr-font-weight-medium)"]);
			// A complete style here would override the size/line-height of the heading or cell it sits in.
			expect(typography.proseSystems[system]).not.toHaveProperty("strong");
		}
		expect(PROSE_SELECTORS).not.toHaveProperty("strong");
	});

	it("emits each prose system as one root class with the shared element selectors", () => {
		for (const system of Object.keys(typography.proseSystems)) {
			const root = proseRootClassName(typography, system);
			expect(GENERATED).toContain(`.${root} {`);
			for (const [id, selector] of Object.entries(PROSE_SELECTORS))
				expect(GENERATED, `${system} prose ${id}`).toContain(`.${root}${selector} {`);
		}
	});

	it("exposes the code family + size tokens Monaco and xterm read", () => {
		expect(GENERATED).toContain("--tr-font-family-code:");
		expect(GENERATED).toContain("--tr-font-size-s11: 11px;");
		expect(GENERATED).toContain("--tr-font-size-s13: 13px;");
		expect(GENERATED).toContain("--tr-line-height-default: 1.6;");
		const monaco = read(join(SRC, "panels/monacoSetup.ts"));
		const xterm = read(join(SRC, "panels/TerminalInstance.tsx"));
		// Monaco reads the s11 editor tier; xterm reads the shared code-text size (s13).
		expect(monaco).toContain('cssVar("--tr-font-size-s11")');
		expect(xterm).toContain('cssVar("--tr-font-size-s13")');
		for (const file of [monaco, xterm]) {
			expect(file).toContain('cssVar("--tr-font-family-code")');
		}
		expect(monaco).toContain('cssVar("--tr-line-height-default")');
	});
});
