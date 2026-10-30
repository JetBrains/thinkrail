import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_FONT_SIZE, DEFAULT_CONFIG } from "@thinkrail/contracts";
import { normalizeEol } from "../../scripts/generatedFiles";
import type { Style, StyleRef, Typography } from "../../scripts/typography";
import {
	allStyles,
	codeDenseDelta,
	codeRowHeight,
	fontSizePx,
	GENERATED_PATH,
	isCodeStyleId,
	isRef,
	isUserSelectable,
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

const typography = loadTypography();
const SRC = fileURLToPath(new URL("..", import.meta.url));
const GENERATED = normalizeEol(readFileSync(GENERATED_PATH, "utf8"));

const read = (p: string) => readFileSync(p, "utf8");
const px = (id: string) => fontSizePx(typography, resolveStyle(typography, id).fontSize);
const rootDeclaration = (name: string) =>
	new RegExp(`^\\t${name}: ([^;]+);$`, "m").exec(GENERATED)?.[1];
const ruleBody = (selector: string) =>
	new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "m").exec(
		GENERATED,
	)?.[1] ?? "";

describe("typography source", () => {
	it("is valid: schema shape, references, ids, full resolution, mono policy", () => {
		expect(validate(typography)).toEqual([]);
	});

	it("resolves every semantic style to all seven properties", () => {
		for (const { id, style } of allStyles(typography)) {
			expect(typography.fontFamilies[style.fontFamily], `${id} family`).toBeDefined();
			expect(fontSizePx(typography, style.fontSize), `${id} size`).toBeDefined();
			expect(typography.fontWeights[style.fontWeight], `${id} weight`).toBeDefined();
			expect(typography.lineHeights[style.lineHeight], `${id} line-height`).toBeDefined();
			expect(typography.letterSpacings[style.letterSpacing], `${id} letter-spacing`).toBeDefined();
			expect(style.textTransform, `${id} transform`).toBeString();
			expect(style.fontStyle, `${id} style`).toBeString();
		}
	});

	it("holds 23 canonical definitions and 30 aliases (53 styles)", () => {
		const styles = allStyles(typography);
		expect(styles).toHaveLength(53);
		expect(styles.filter((s) => !s.ref)).toHaveLength(23);
		expect(styles.filter((s) => s.ref)).toHaveLength(30);
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
			metadata: 1.25,
			ui: 1.3,
			code: 1.4,
			relaxed: 1.4,
			default: 1.3,
			reading: 1.45,
		});
		expect(typography.fontWeights).toEqual({
			light: 370,
			regular: 400,
			medium: 500,
			semibold: 600,
			brand: 400,
			button: 470,
		});
		expect(typography.fontWeightOffset).toEqual({ exclude: ["brand"] });
		expect(typography.codeSize).toEqual({ fontSize: "s13" });
		expect(typography.codeRow).toEqual({ fontSize: "s11", lineHeight: "default" });
		for (const id of ["interface", "code", "brand"]) {
			const family = resolveFamily(typography, id);
			expect(family.selfHosted ?? [], `${id} self-hosted`).not.toEqual([]);
			expect(family.stack[0], `${id} leads with its bundled face`).not.toMatch(
				/^(?:-apple-system|sans-serif|serif|monospace)$/,
			);
		}
		expect(isRef(typography.fontFamilies.brand)).toBe(false);
		expect(resolveFamily(typography, "brand").stack[0]).toBe("Orbitron Variable");
		expect(resolveFamily(typography, "brand")).not.toEqual(resolveFamily(typography, "interface"));
		expect(Object.values(typography.lineHeights)).not.toContain(1.65);
	});

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
			caption: 500,
			action: 500,
			button: 470,
			emphasis: 500,
		});
	});

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

	it("gives the document scale headings larger than its body text", () => {
		const body = px("doc.body") as number;
		expect(body).toBe(14);
		expect(["h1", "h2", "h3", "h4"].map((h) => px(`doc.${h}`))).toEqual([24, 20, 18, 16]);
		for (const h of ["h1", "h2", "h3", "h4"])
			expect(px(`doc.${h}`), `doc.${h} > body`).toBeGreaterThan(body);
		const ladder = ["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => px(`doc.${h}`) as number);
		for (let i = 1; i < ladder.length; i++)
			expect(ladder[i], `doc.h${i + 1} <= doc.h${i}`).toBeLessThanOrEqual(ladder[i - 1] as number);
		expect(resolveStyle(typography, "doc.h5")).toMatchObject({ fontWeight: "semibold" });
		expect(resolveStyle(typography, "doc.h6")).toMatchObject({
			fontWeight: "semibold",
			textTransform: "uppercase",
		});
		expect(px("doc.codeBlock")).toBe(13);
		expect(px("doc.codeBlock")).toBeGreaterThanOrEqual(px("chat.codeBlock") as number);
	});

	it("shares its canonical definitions across both surfaces", () => {
		expect(resolveStyle(typography, "chat.h1")).toEqual(resolveStyle(typography, "doc.h3"));
		expect(rawStyle(typography, "chat.h1")).toEqual({ $ref: "heading.md" });
		expect(rawStyle(typography, "doc.h3")).toEqual({ $ref: "heading.md" });
		for (const id of ["chat.body", "doc.body", "chat.blockquote", "doc.list", "title.entity"])
			expect(resolveStyle(typography, id), id).toEqual(resolveStyle(typography, "body.reading"));
	});
});

describe("references", () => {
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
		const root = resolveStyle(typography, typography.rootStyle.$ref);
		expect(block?.[1]).toContain(`--tr-font-size-${root.fontSize}`);
		expect(block?.[1]).toContain(`--tr-font-weight-${root.fontWeight}`);
	});

	it("emits the semantic classes inside @layer components, so utilities can override them", () => {
		const layerStart = GENERATED.indexOf("@layer components {");
		expect(layerStart, "the semantic classes must be layered").toBeGreaterThan(-1);
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

	it("exposes the code tokens Monaco, xterm and Pierre read, the editors through the generated code styles", () => {
		expect(rootDeclaration("--tr-font-family-code")).toBe("var(--tr-font-family-code-default)");
		expect(rootDeclaration("--tr-font-size-code")).toBe("var(--tr-font-size-s13)");
		expect(rootDeclaration("--tr-font-size-code-dense")).toBe(
			"calc(var(--tr-font-size-code) - 2px)",
		);
		expect(rootDeclaration("--tr-line-height-default")).toBe("1.3");
		expect(rootDeclaration("--tr-code-row-height")).toBe("14px");
		const monaco = read(
			join(SRC, "../../../packages/resource-renderers/src/support/monacoSetup.ts"),
		);
		const xterm = read(join(SRC, "panels/TerminalInstance.tsx"));
		const pierre =
			/^\.pierre-code-surface \{([^}]*)\}/m.exec(read(join(SRC, "index.css")))?.[1] ?? "";
		expect(monaco).toContain('resolveFont("tr-code-editor")');
		expect(xterm).toContain('resolveFont("tr-code-block")');
		expect(monaco).toContain('cssVar("--tr-line-height-default")');
		expect(pierre).toContain("--diffs-font-size: var(--tr-font-size-code-dense);");
		expect(pierre).toContain("--diffs-line-height: var(--tr-code-row-height);");
		expect(pierre).toContain("font-variant-ligatures: var(--tr-font-ligatures-code);");
	});
});

describe("user-adjustable tokens", () => {
	it("routes each user-selectable family through its -default token, and brand through none", () => {
		const selectable = Object.keys(typography.fontFamilies).filter((id) =>
			isUserSelectable(typography, id),
		);
		expect(selectable).toEqual(["interface", "code"]);
		for (const id of selectable) {
			expect(rootDeclaration(`--tr-font-family-${id}`), id).toBe(
				`var(--tr-font-family-${id}-default)`,
			);
			expect(rootDeclaration(`--tr-font-family-${id}-default`), id).toStartWith(
				`"${resolveFamily(typography, id).stack[0]}"`,
			);
		}
		expect(rootDeclaration("--tr-font-family-brand-default")).toBeUndefined();
		expect(rootDeclaration("--tr-font-family-brand")).toStartWith('"Orbitron Variable"');
		expect(rootDeclaration("--tr-font-family-brand")).not.toContain("var(");
	});

	it("shifts every weight but brand by one offset, over the validated base values", () => {
		expect(rootDeclaration("--tr-font-weight-offset")).toBe("0");
		for (const [id, base] of Object.entries(typography.fontWeights))
			expect(rootDeclaration(`--tr-font-weight-${id}`), id).toBe(
				id === "brand" ? String(base) : `calc(${base} + var(--tr-font-weight-offset))`,
			);
	});

	it("sizes code blocks from the code size and the editor sample from the dense size", () => {
		const size = (id: string) => resolveStyle(typography, id).fontSize;
		expect(codeDenseDelta(typography)).toBe(2);
		expect(codeRowHeight(typography)).toBe(14);
		for (const id of ["code.block", "code.document", "chat.codeBlock", "doc.codeBlock"]) {
			expect(size(id), id).toBe("code");
			expect(px(id), id).toBe(13);
		}
		expect(size("code.editor")).toBe("codeDense");
		expect(px("code.editor")).toBe(11);
		for (const id of ["code.text", "chat.inlineCode", "doc.inlineCode", "doc.tableInlineCode"])
			expect(size(id), `${id} is inline code`).toBe("s13");
		for (const id of ["code.textSmall", "chat.tableInlineCode"])
			expect(size(id), `${id} is inline code`).toBe("s11");
		expect(ruleBody(".tr-prose-chat :is(pre, pre code)")).toContain(
			"font-size: var(--tr-font-size-code);",
		);
		expect(ruleBody(".tr-prose-doc :is(pre, pre code)")).toContain(
			"font-size: var(--tr-font-size-code);",
		);
		expect(ruleBody(".tr-code-editor")).toContain("font-size: var(--tr-font-size-code-dense);");
	});

	it("turns ligatures off by default on every code style, and touches no other style", () => {
		expect(rootDeclaration("--tr-font-ligatures-code")).toBe("none");
		for (const { id, group, name, prose } of allStyles(typography)) {
			const selector = prose
				? `.${proseRootClassName(typography, group)}${PROSE_SELECTORS[name]}`
				: `.${styleClassName(typography, group, name)}`;
			const body = ruleBody(selector);
			expect(body, `${selector} is emitted`).toContain("font-family:");
			expect(body.includes("font-variant-ligatures: var(--tr-font-ligatures-code);"), id).toBe(
				isCodeStyleId(typography, id),
			);
		}
	});

	it("starts the host's font settings where the JSON defaults are", () => {
		expect(DEFAULT_CONFIG.codeFontSize).toBe(fontSizePx(typography, "code") as number);
		expect(DEFAULT_CONFIG.codeLigatures).toBe(
			resolveFamily(typography, "code").ligatures === "normal",
		);
		expect(DEFAULT_CONFIG.fontWeightOffset).toBe(
			Number(rootDeclaration("--tr-font-weight-offset")),
		);
		expect(CODE_FONT_SIZE.editorDelta).toBe(
			(fontSizePx(typography, "code") as number) - (fontSizePx(typography, "codeDense") as number),
		);
	});
});

describe("user-adjustable token validation", () => {
	const withSource = (patch: Record<string, unknown>) =>
		validate({ ...typography, ...patch } as unknown as Typography);
	const code = resolveFamily(typography, "code");

	it("rejects a primitive id that collides with a generated adjustable token", () => {
		expect(withSource({ fontSizes: { ...typography.fontSizes, codeDense: 11 } })).toContain(
			"fontSizes.codeDense: reserved for the code size tokens",
		);
		expect(withSource({ fontWeights: { ...typography.fontWeights, offset: 400 } })).toContain(
			"fontWeights.offset: reserved for the weight offset token",
		);
		expect(
			withSource({
				fontFamilies: {
					...typography.fontFamilies,
					codeDefault: { ...code, userSelectable: false },
				},
			}),
		).toContain("fontFamilies.codeDefault: collides with the default token of 'code'");
	});

	it("rejects a malformed family flag, ligatures value or excluded weight", () => {
		const family = (patch: Record<string, unknown>) =>
			withSource({ fontFamilies: { ...typography.fontFamilies, code: { ...code, ...patch } } });
		expect(family({ userSelectable: "yes" })).toContain(
			"fontFamilies.code.userSelectable: must be a boolean",
		);
		expect(family({ ligatures: "contextual" })).toContain(
			"fontFamilies.code.ligatures: must be one of normal, none",
		);
		expect(withSource({ fontWeightOffset: { exclude: ["heavy"] } })).toContain(
			"fontWeightOffset.exclude: unknown font weight 'heavy'",
		);
		expect(withSource({ fontWeightOffset: { exclude: "brand" } })).toContain(
			"fontWeightOffset.exclude must be an array of font weight ids",
		);
	});

	it("keeps the code size blocks closed, known, and the dense row below the code size", () => {
		expect(withSource({ codeSize: { fontSize: "s99" } })).toContain(
			"codeSize.fontSize: unknown font size 's99'",
		);
		expect(withSource({ codeSize: { fontSize: "s13", lineHeight: "code" } })).toContain(
			"codeSize: unexpected property 'lineHeight'",
		);
		expect(withSource({ codeRow: { fontSize: "s14", lineHeight: "default" } })).toContain(
			"codeRow.fontSize: the dense code row must be smaller than codeSize.fontSize (14px vs 13px)",
		);
	});

	it("lets a style name the two code sizes, and no other id outside fontSizes", () => {
		const block = { ...(typography.textStyles.code?.block as Style), fontSize: "codeLarge" };
		expect(
			withSource({
				textStyles: { ...typography.textStyles, code: { ...typography.textStyles.code, block } },
			}),
		).toContain("code.block.fontSize: unknown fontSizes token 'codeLarge'");
	});
});
