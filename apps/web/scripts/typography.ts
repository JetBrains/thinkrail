/**
 * The typography pipeline: load → validate → render CSS.
 *
 * `styles/typography.json` is the ONLY source of typography values. This module derives every CSS
 * custom property, the document base rule, every semantic class and every prose selector from it;
 * nothing downstream may invent a size, a weight, a line-height or a family. Naming is mechanical (see
 * `cssVarName` / `styleClassName` / `proseRootClassName`), so a new token, style or prose system needs no
 * code change here.
 *
 * Entry points: `generate-typography.ts` (write / --check) and `validate-typography.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const STYLES_DIR = join(import.meta.dir, "..", "src", "styles");
export const SOURCE_PATH = join(STYLES_DIR, "typography.json");
export const SCHEMA_PATH = join(STYLES_DIR, "typography.schema.json");
export const GENERATED_PATH = join(STYLES_DIR, "generated", "typography.css");
export const GENERATED_FONTS_PATH = join(STYLES_DIR, "generated", "fonts.css");
const PACKAGE_JSON = join(import.meta.dir, "..", "package.json");

/** `{ "$ref": "title.dialog" }` — "identical to that style". The whole reference mechanism. */
export interface StyleRef {
	$ref: string;
}

export interface FontFamily {
	stack: string[];
	kind: "proportional" | "monospace";
	/**
	 * The npm entry points that ship this family's faces, if we self-host it. Declared HERE so the
	 * stack and the bundled packages cannot drift: a family named in a stack with no package behind it
	 * renders as a silent fallback, which is invisible in review and in the browser.
	 */
	selfHosted?: string[];
}

export interface Style {
	fontFamily: string;
	fontSize: string;
	fontWeight: string;
	lineHeight: string;
	letterSpacing: string;
	textTransform: "none" | "uppercase" | "lowercase" | "capitalize";
	fontStyle: "normal" | "italic";
}

export interface Typography {
	$schema: string;
	metadata: { version: string; cssVarPrefix: string; classPrefix: string };
	fontFamilies: Record<string, FontFamily | StyleRef>;
	fontWeights: Record<string, number>;
	fontSizes: Record<string, number>;
	lineHeights: Record<string, number>;
	letterSpacings: Record<string, string>;
	/** The `<body>` fallback for text that carries no semantic class. Always a `$ref`, never values. */
	rootStyle: StyleRef;
	textStyles: Record<string, Record<string, Style | StyleRef>>;
	/** One entry per markdown surface (`chat`, `doc`); each owns the full `PROSE_SELECTORS` element set. */
	proseSystems: Record<string, Record<string, Style | StyleRef>>;
}

export function loadTypography(path = SOURCE_PATH): Typography {
	return JSON.parse(readFileSync(path, "utf8")) as Typography;
}

export const isRef = (value: unknown): value is StyleRef =>
	typeof value === "object" && value !== null && "$ref" in value;

/** Is `group` a prose system (rather than a `textStyles` group)? */
export const isProseGroup = (t: Typography, group: string): boolean =>
	group in (t.proseSystems ?? {});

/** The raw entry at `<group>.<name>` — a definition or a reference. Groups span both style spaces. */
export function rawStyle(t: Typography, id: string): Style | StyleRef | undefined {
	const [group, name] = id.split(".");
	if (!group || !name) return undefined;
	return isProseGroup(t, group) ? t.proseSystems[group]?.[name] : t.textStyles?.[group]?.[name];
}

/**
 * Resolve a style id to its canonical definition — ONE hop, by design. A reference must point straight
 * at a definition (see `validate`), so there is no chain to walk and no inheritance to merge.
 */
export function resolveStyle(t: Typography, id: string): Style {
	const entry = rawStyle(t, id);
	if (!entry) throw new Error(`unknown style '${id}'`);
	if (!isRef(entry)) return entry;
	const target = rawStyle(t, entry.$ref);
	if (!target) throw new Error(`${id}: $ref to unknown style '${entry.$ref}'`);
	if (isRef(target))
		throw new Error(
			`${id}: $ref to '${entry.$ref}', which is itself a reference (chains are invalid)`,
		);
	return target;
}

/** Resolve a font family id — the same single hop. */
export function resolveFamily(t: Typography, id: string): FontFamily {
	const entry = t.fontFamilies?.[id];
	if (!entry) throw new Error(`unknown font family '${id}'`);
	if (!isRef(entry)) return entry;
	const target = t.fontFamilies?.[entry.$ref];
	if (!target) throw new Error(`fontFamilies.${id}: $ref to unknown family '${entry.$ref}'`);
	if (isRef(target))
		throw new Error(
			`fontFamilies.${id}: $ref to '${entry.$ref}', which is itself a reference (chains are invalid)`,
		);
	return target;
}

/* ── naming (the single place CSS identifiers are derived) ───────────────────────────────────── */

/** `@fontsource-variable/geist/wght-italic.css` → `@fontsource-variable/geist`. */
export const packageRoot = (entry: string) => entry.split("/").slice(0, 2).join("/");

let dependencyCache: Set<string> | undefined;
function declaredDependencies(): Set<string> {
	dependencyCache ??= new Set(
		Object.keys(
			(JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { dependencies?: Record<string, string> })
				.dependencies ?? {},
		),
	);
	return dependencyCache;
}

/** The `@import`s that pull the self-hosted faces into the bundle, in declaration order. */
export function renderFontsCss(t: Typography): string {
	const imports = Object.values(t.fontFamilies ?? {})
		.filter((f): f is FontFamily => !isRef(f))
		.flatMap((f) => f.selfHosted ?? []);
	return `${FONTS_HEADER(t.metadata.version)}${imports.map((i) => `@import "${i}";`).join("\n")}\n`;
}

const FONTS_HEADER = (version: string) => `/*
 * GENERATED — do not edit. Source: \`src/styles/typography.json\` (v${version}), the \`selfHosted\`
 * entries of each font family. Regenerate with \`bun run typography:generate\`.
 *
 * The app's faces are self-hosted — no runtime call to a font CDN. ThinkRail runs locally (often
 * offline) and ships as a single-file binary, so the fonts have to be part of the artifact: Vite
 * fingerprints these woff2 files into \`dist/assets\` and the CLI embeds that output. A \`<link>\` to a
 * font CDN satisfied none of it — it left an air-gapped host in system faces, put first paint behind a
 * third party, and contacted the CDN on every load despite the app's analytics opt-out.
 *
 * Both packages are VARIABLE (wght 100–900 / 100–800) with real italics, which is what makes the type
 * scale honest: the brand weight (800) and markdown \`<em>\` are real faces, not the browser's
 * synthetic bold/oblique. Every unicode subset stays declared — each is its own \`@font-face\` with a
 * \`unicode-range\`, so a document downloads only the ranges it renders.
 */
`;

const kebab = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export function cssVarName(t: Typography, group: string, id: string): string {
	return `--${t.metadata.cssVarPrefix}-${group}-${kebab(id)}`;
}

/** `title.dialog` → `tr-title-dialog`; `ui.default` → `tr-text-ui`; `code.inline` → `tr-code-inline`. */
export function styleClassName(t: Typography, group: string, id: string): string {
	const p = t.metadata.classPrefix;
	if (group === "ui") return id === "default" ? `${p}-text-ui` : `${p}-text-${kebab(id)}`;
	if (group === "body") return `${p}-text-${kebab(id)}`;
	return `${p}-${group}-${kebab(id)}`;
}

/** `chat` → `tr-prose-chat`; `doc` → `tr-prose-doc`. One root class per markdown surface. */
export function proseRootClassName(t: Typography, system: string): string {
	return `${t.metadata.classPrefix}-prose-${kebab(system)}`;
}

/**
 * The weight `<strong>`/`<b>` gets inside prose. It is deliberately NOT a semantic style: a complete
 * style would override the size and line-height of whatever element the bold text sits in (a heading, a
 * table cell), so the emitted rule sets weight alone and inherits the rest.
 */
export const PROSE_STRONG_WEIGHT = "medium";

/**
 * Which element each prose style owns, inside every prose system's root class. `body` styles the root
 * itself. Every system must define exactly this key set — that is what makes the surfaces comparable.
 */
export const PROSE_SELECTORS: Record<string, string> = {
	body: "",
	h1: " h1",
	h2: " h2",
	h3: " h3",
	h4: " h4",
	h5: " h5",
	h6: " h6",
	inlineCode: " :not(pre) > code",
	codeBlock: " :is(pre, pre code)",
	blockquote: " blockquote",
	list: " :is(ul, ol, li)",
	tableBody: " :is(table, td)",
	tableHeader: " th",
};

/** The prose roles that render code, in every prose system. */
export const PROSE_CODE_NAMES = new Set(["inlineCode", "codeBlock"]);

/* ── validation ─────────────────────────────────────────────────────────────────────────────── */

/** `textStyles` ids allowed to use a monospace family — every other one must be proportional. */
export const CODE_STYLE_IDS = new Set([
	"code.text",
	"code.inline",
	"code.block",
	"code.document",
	"code.otp",
]);

/** Should `id` render in a monospace family? The single definition of the mono policy. */
export function isCodeStyleId(t: Typography, id: string): boolean {
	const [group, name] = id.split(".");
	if (!group || !name) return false;
	return isProseGroup(t, group) ? PROSE_CODE_NAMES.has(name) : CODE_STYLE_IDS.has(id);
}

export interface ResolvedStyle {
	id: string;
	group: string;
	name: string;
	style: Style;
	/** The id this entry points at, or null when it is a canonical definition. */
	ref: string | null;
	/** True for a `proseSystems` entry — it owns an element selector, not a class. */
	prose: boolean;
}

/** Every style, RESOLVED (references followed), in source order. */
export function allStyles(t: Typography): ResolvedStyle[] {
	const out: ResolvedStyle[] = [];
	const push = (group: string, name: string, entry: Style | StyleRef, prose: boolean) => {
		const id = `${group}.${name}`;
		out.push({
			id,
			group,
			name,
			style: resolveStyle(t, id),
			ref: isRef(entry) ? entry.$ref : null,
			prose,
		});
	};
	for (const [group, styles] of Object.entries(t.textStyles))
		for (const [name, entry] of Object.entries(styles)) push(group, name, entry, false);
	for (const [system, styles] of Object.entries(t.proseSystems))
		for (const [name, entry] of Object.entries(styles)) push(system, name, entry, true);
	return out;
}

/** Schema-shape + referential + policy validation. Returns human-readable errors (empty = valid). */
export function validate(t: Typography): string[] {
	const errors: string[] = [];
	const fail = (m: string) => errors.push(m);

	const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
	for (const key of schema.required as string[])
		if (!(key in t)) fail(`missing required top-level key: ${key}`);
	if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(t.metadata?.version ?? ""))
		fail("metadata.version must be semver");
	for (const p of ["cssVarPrefix", "classPrefix"] as const)
		if (!/^[a-z][a-z0-9-]*$/.test(t.metadata?.[p] ?? "")) fail(`metadata.${p} must be kebab-safe`);

	const ID = /^[a-zA-Z][a-zA-Z0-9]*$/;
	const primitives = {
		fontFamilies: t.fontFamilies,
		fontWeights: t.fontWeights,
		fontSizes: t.fontSizes,
		lineHeights: t.lineHeights,
		letterSpacings: t.letterSpacings,
	};
	for (const [group, map] of Object.entries(primitives)) {
		if (!map || Object.keys(map).length === 0) fail(`${group} must not be empty`);
		for (const id of Object.keys(map ?? {}))
			if (!ID.test(id)) fail(`${group}.${id}: invalid token id`);
	}
	for (const [id, f] of Object.entries(t.fontFamilies ?? {})) {
		if (isRef(f)) {
			if (Object.keys(f).length > 1)
				fail(`fontFamilies.${id}: a $ref may not carry other properties`);
			if (!(f.$ref in (t.fontFamilies ?? {})))
				fail(`fontFamilies.${id}: $ref to unknown family '${f.$ref}'`);
			continue;
		}
		if (!Array.isArray(f.stack) || f.stack.length === 0) fail(`fontFamilies.${id}: empty stack`);
		if (f.kind !== "proportional" && f.kind !== "monospace") fail(`fontFamilies.${id}: bad kind`);
		for (const entry of f.selfHosted ?? []) {
			if (!declaredDependencies().has(packageRoot(entry))) {
				fail(`fontFamilies.${id}.selfHosted: ${entry} is not a dependency of apps/web`);
			}
		}
	}
	// …and the other direction: a font package nobody claims is dead weight in the bundle.
	const claimed = new Set(
		Object.values(t.fontFamilies ?? {})
			.filter((f): f is FontFamily => !isRef(f))
			.flatMap((f) => (f.selfHosted ?? []).map(packageRoot)),
	);
	for (const dep of declaredDependencies()) {
		if (/fontsource/.test(dep) && !claimed.has(dep)) {
			fail(`${dep} is installed but no fontFamily declares it in selfHosted`);
		}
	}
	if (errors.length > 0) return errors;
	for (const id of Object.keys(t.fontFamilies ?? {}))
		try {
			resolveFamily(t, id);
		} catch (e) {
			fail(`fontFamilies.${id}: ${(e as Error).message}`);
		}
	if (errors.length > 0) return errors;
	for (const [id, w] of Object.entries(t.fontWeights ?? {}))
		if (!Number.isInteger(w) || w < 100 || w > 900) fail(`fontWeights.${id}: out of range`);
	for (const [id, v] of Object.entries(t.fontSizes ?? {}))
		if (!(v > 0)) fail(`fontSizes.${id}: must be > 0`);
	for (const [id, v] of Object.entries(t.lineHeights ?? {}))
		if (!(v > 0)) fail(`lineHeights.${id}: must be > 0`);

	// Ids are `<group>.<name>`, so a group name may not mean two things.
	for (const group of Object.keys(t.proseSystems ?? {}))
		if (group in (t.textStyles ?? {}))
			fail(
				`'${group}' is both a textStyles group and a prose system — group names must be distinct`,
			);
	if (Object.keys(t.proseSystems ?? {}).length === 0) fail("proseSystems must not be empty");
	if (errors.length > 0) return errors;

	// References: direct only. A `$ref` must name a canonical DEFINITION — never another reference —
	// so resolution is one lookup and there is no chain, cycle or inheritance to reason about.
	const rawEntries: [string, Style | StyleRef][] = [
		...Object.entries(t.textStyles ?? {}).flatMap(([group, styles]) =>
			Object.entries(styles).map(
				([name, entry]) => [`${group}.${name}`, entry] as [string, Style | StyleRef],
			),
		),
		...Object.entries(t.proseSystems ?? {}).flatMap(([system, styles]) =>
			Object.entries(styles).map(
				([name, entry]) => [`${system}.${name}`, entry] as [string, Style | StyleRef],
			),
		),
	];
	for (const [id, entry] of rawEntries) {
		if (!isRef(entry)) continue;
		if (Object.keys(entry).length > 1) fail(`${id}: a $ref may not carry other properties`);
		if (entry.$ref === id) {
			fail(`${id}: $ref points at itself`);
			continue;
		}
		const target = rawStyle(t, entry.$ref);
		if (!target) {
			fail(`${id}: $ref to unknown style '${entry.$ref}'`);
			continue;
		}
		if (isRef(target))
			fail(
				`${id} references ${entry.$ref}, which is itself a reference. ` +
					`Reference ${target.$ref} directly.`,
			);
	}
	// The document base names a semantic style rather than repeating one, so `<body>` can never drift.
	const root = t.rootStyle;
	if (!isRef(root)) fail("rootStyle must be a $ref to a semantic style, not a set of values");
	else if (Object.keys(root).length > 1) fail("rootStyle: a $ref may not carry other properties");
	else {
		const target = rawStyle(t, root.$ref);
		if (!target) fail(`rootStyle: $ref to unknown style '${root.$ref}'`);
		else if (isRef(target)) fail(`rootStyle: $ref to '${root.$ref}', which is itself a reference`);
	}
	if (errors.length > 0) return errors;

	// Ids unique across the whole style space (a duplicate would silently overwrite a class).
	const seen = new Set<string>();
	for (const { id } of allStyles(t)) {
		if (seen.has(id)) fail(`duplicate style id: ${id}`);
		seen.add(id);
	}
	// Generated class names must be unique too — two ids may not collapse onto one class.
	const classes = new Map<string, string>();
	for (const { id, group, name, prose } of allStyles(t)) {
		if (prose) continue;
		const cls = styleClassName(t, group, name);
		const prev = classes.get(cls);
		if (prev) fail(`class collision: '${id}' and '${prev}' both generate .${cls}`);
		classes.set(cls, id);
	}

	// Two canonical definitions may not hold identical values — that is a missing $ref.
	const byValue = new Map<string, string>();
	for (const { id, style, ref } of allStyles(t)) {
		if (ref) continue;
		const key = JSON.stringify(style);
		const first = byValue.get(key);
		if (first) fail(`${id} duplicates ${first} — identical canonical definitions must use a $ref`);
		else byValue.set(key, id);
	}

	// Every style fully resolves, and every reference exists.
	const REQUIRED: (keyof Style)[] = [
		"fontFamily",
		"fontSize",
		"fontWeight",
		"lineHeight",
		"letterSpacing",
		"textTransform",
		"fontStyle",
	];
	for (const { id, style } of allStyles(t)) {
		for (const prop of REQUIRED)
			if (style[prop] === undefined) fail(`${id}: does not fully resolve — missing ${prop}`);
		for (const [prop, map, label] of [
			["fontFamily", t.fontFamilies, "fontFamilies"],
			["fontSize", t.fontSizes, "fontSizes"],
			["fontWeight", t.fontWeights, "fontWeights"],
			["lineHeight", t.lineHeights, "lineHeights"],
			["letterSpacing", t.letterSpacings, "letterSpacings"],
		] as const)
			if (style[prop] !== undefined && !(style[prop] in (map ?? {})))
				fail(`${id}.${prop}: unknown ${label} token '${style[prop]}'`);
		if (!["none", "uppercase", "lowercase", "capitalize"].includes(style.textTransform))
			fail(`${id}.textTransform: invalid`);
		if (!["normal", "italic"].includes(style.fontStyle)) fail(`${id}.fontStyle: invalid`);
		const raw = rawStyle(t, id);
		if (raw && !isRef(raw))
			for (const key of Object.keys(raw))
				if (!REQUIRED.includes(key as keyof Style)) fail(`${id}: unexpected property '${key}'`);
	}

	// Mono is code-only: no proportional role may reference a monospace family, and vice versa.
	for (const { id, style } of allStyles(t)) {
		if (!(style.fontFamily in (t.fontFamilies ?? {}))) continue;
		const isMono = resolveFamily(t, style.fontFamily).kind === "monospace";
		if (isMono && !isCodeStyleId(t, id))
			fail(`${id}: monospace family on a non-code semantic style`);
		if (!isMono && isCodeStyleId(t, id)) fail(`${id}: code style must use a monospace family`);
	}
	// The `<body>` fallback is interface text, never a code face.
	if (isRef(t.rootStyle) && rawStyle(t, t.rootStyle.$ref)) {
		const rootFamily = resolveStyle(t, t.rootStyle.$ref).fontFamily;
		if (rootFamily in (t.fontFamilies ?? {}) && resolveFamily(t, rootFamily).kind === "monospace")
			fail("rootStyle: the document base must be proportional");
	}

	// The weight-only <strong> rule references this token directly.
	if (!(PROSE_STRONG_WEIGHT in (t.fontWeights ?? {})))
		fail(`fontWeights.${PROSE_STRONG_WEIGHT}: missing — the prose <strong> rule references it`);

	// Every prose system owns exactly the shared element set — that is what makes the surfaces
	// comparable, and what stops a markdown element from silently having no typography on one of them.
	for (const [system, styles] of Object.entries(t.proseSystems ?? {})) {
		for (const id of Object.keys(PROSE_SELECTORS))
			if (!(id in styles)) fail(`proseSystems.${system}.${id}: missing (the element set is fixed)`);
		for (const id of Object.keys(styles))
			if (!(id in PROSE_SELECTORS))
				fail(`proseSystems.${system}.${id}: no selector mapping — unused prose style`);
	}

	// Card title must be typographically identical to dialog title.
	const dialog = rawStyle(t, "title.dialog") ? resolveStyle(t, "title.dialog") : undefined;
	const card = rawStyle(t, "title.card") ? resolveStyle(t, "title.card") : undefined;
	if (dialog && card && JSON.stringify(dialog) !== JSON.stringify(card))
		fail("title.card must be typographically identical to title.dialog");

	// A document surface must keep a visible hierarchy: h1–h4 strictly larger than its own body text,
	// and each level no larger than the one above it. This is the rule the em-ladder used to give us.
	const docSystem = t.proseSystems?.doc;
	if (docSystem) {
		const px = (name: string) => t.fontSizes[resolveStyle(t, `doc.${name}`).fontSize] ?? 0;
		const body = px("body");
		for (const level of ["h1", "h2", "h3", "h4"])
			if (!(px(level) > body))
				fail(`doc.${level}: must be larger than doc.body (${px(level)}px vs ${body}px)`);
		const ladder = ["h1", "h2", "h3", "h4", "h5", "h6"];
		for (let i = 1; i < ladder.length; i++)
			if (px(ladder[i] as string) > px(ladder[i - 1] as string))
				fail(`doc.${ladder[i]}: larger than doc.${ladder[i - 1]} — the ladder must not invert`);
	}

	return errors;
}

/* ── CSS rendering ──────────────────────────────────────────────────────────────────────────── */

const HEADER = (version: string) => `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source:    src/styles/typography.json (v${version})
 * Generator: scripts/generate-typography.ts  ·  regenerate: bun run typography:generate
 * Drift gate: bun run typography:check (fails when this file is stale)
 *
 * Contains every typography value the UI is allowed to use: primitive custom properties, the \`<body>\`
 * base, one class per semantic text style, and one prose system per markdown surface.
 *
 * Two cascade layers, both deliberate. The \`<body>\` base sits in \`@layer base\` (after Tailwind's
 * preflight, so it wins there) which means ANY semantic class outranks it. The classes sit in
 * \`@layer components\`: Tailwind v4 orders its layers \`theme, base, components, utilities\`, so a
 * semantic class beats the base while a Tailwind utility at a call site — \`italic\`, \`leading-tight\`,
 * \`leading-snug\` — can still override the one property it names. Unlayered CSS would outrank every
 * layer and silently win instead.
 */\n`;

function declarations(t: Typography, style: Style, indent = "\t"): string {
	const lines = [
		`font-family: var(${cssVarName(t, "font-family", style.fontFamily)});`,
		`font-size: var(${cssVarName(t, "font-size", style.fontSize)});`,
		`font-weight: var(${cssVarName(t, "font-weight", style.fontWeight)});`,
		`line-height: var(${cssVarName(t, "line-height", style.lineHeight)});`,
		`letter-spacing: var(${cssVarName(t, "letter-spacing", style.letterSpacing)});`,
		`text-transform: ${style.textTransform};`,
		`font-style: ${style.fontStyle};`,
	];
	return lines.map((l) => indent + l).join("\n");
}

export function renderCss(t: Typography): string {
	const out: string[] = [HEADER(t.metadata.version)];

	out.push(":root {");
	out.push("\t/* Font families */");
	for (const id of Object.keys(t.fontFamilies))
		out.push(
			`\t${cssVarName(t, "font-family", id)}: ${resolveFamily(t, id).stack.map(quote).join(", ")};`,
		);
	out.push("\n\t/* Font weights */");
	for (const [id, w] of Object.entries(t.fontWeights))
		out.push(`\t${cssVarName(t, "font-weight", id)}: ${w};`);
	out.push("\n\t/* Font sizes (px) */");
	for (const [id, v] of Object.entries(t.fontSizes))
		out.push(`\t${cssVarName(t, "font-size", id)}: ${v}px;`);
	out.push("\n\t/* Line heights (unitless) */");
	for (const [id, v] of Object.entries(t.lineHeights))
		out.push(`\t${cssVarName(t, "line-height", id)}: ${v};`);
	out.push("\n\t/* Letter spacing */");
	for (const [id, v] of Object.entries(t.letterSpacings))
		out.push(`\t${cssVarName(t, "letter-spacing", id)}: ${v};`);
	out.push("}\n");

	// The document base. In `base` so every semantic class beats it: it is the fallback for text that
	// carries no class, never a value a component relies on.
	out.push(
		`/* Document base — \`rootStyle\` (${t.rootStyle.$ref}). Any semantic class overrides it. */`,
	);
	out.push("@layer base {");
	out.push("\tbody {");
	out.push(declarations(t, resolveStyle(t, t.rootStyle.$ref), "\t\t"));
	out.push("\t}");
	out.push("}\n");

	// Everything below is layered so Tailwind utilities can override a single property at a call site.
	out.push("@layer components {");
	out.push("/* Semantic text styles — one class per style. Colour stays at the call site. */");
	for (const [group, styles] of Object.entries(t.textStyles))
		for (const name of Object.keys(styles)) {
			out.push(`.${styleClassName(t, group, name)} {`);
			out.push(declarations(t, resolveStyle(t, `${group}.${name}`)));
			out.push("}");
		}

	// One prose system per markdown surface. Same element set everywhere, its own type per surface.
	for (const [system, styles] of Object.entries(t.proseSystems)) {
		const root = proseRootClassName(t, system);
		out.push("");
		out.push(`/* Prose system '${system}' — the markdown typography for that surface. */`);
		for (const name of Object.keys(styles)) {
			const selector = PROSE_SELECTORS[name] ?? "";
			out.push(`.${root}${selector} {`);
			out.push(declarations(t, resolveStyle(t, `${system}.${name}`)));
			out.push("}");
		}
		// `<strong>` / `<b>`: WEIGHT ONLY. Family, size, line-height, tracking, transform and colour
		// inherit from the enclosing prose element, so bold inside a heading keeps the heading's size,
		// bold in a table cell keeps the table's size, and bold in body text keeps the body's. The
		// (0,1,1) specificity beats preflight's `strong { font-weight: bolder }`.
		out.push(`/* Bold: weight only — every other property inherits from the parent element. */`);
		out.push(`.${root} :is(strong, b) {`);
		out.push(`\tfont-weight: var(${cssVarName(t, "font-weight", PROSE_STRONG_WEIGHT)});`);
		out.push("}");
	}
	out.push("}");
	return `${out.join("\n")}\n`;
}

const quote = (family: string) => (/^[a-zA-Z-]+$/.test(family) ? family : `"${family}"`);
