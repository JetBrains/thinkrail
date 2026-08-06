import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	allStyles,
	loadTypography,
	proseRootClassName,
	resolveStyle,
	styleClassName,
} from "../../scripts/typography";

/**
 * The adoption guard: components may not re-declare typography that a generated semantic style already
 * owns, may not name a class the system does not emit, and each markdown surface must wear exactly one
 * generated prose system. These are the checks that keep the JSON authoritative over time.
 *
 * Two failure modes shaped this file, both of which shipped once:
 *  - a class name that LOOKS like ours but is not emitted (`text-eyebrow`) — Tailwind drops unknown
 *    utilities silently, so the element renders unstyled while the class list claims otherwise;
 *  - an element with NO typography class, which then inherits whatever the browser's preflight says
 *    (a bare `<pre>` gets the OS monospace stack, not our code face).
 * A denylist alone catches neither, so the checks below are a mix of deny, allow and must-have.
 */

const typography = loadTypography();
const SRC = new URL("..", import.meta.url).pathname;

/** Every source file the UI ships, minus the generated CSS and the tests themselves. */
function sourceFiles(dir = SRC): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			if (entry === "generated") continue;
			out.push(...sourceFiles(path));
			continue;
		}
		if (/\.(tsx?|css)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(path);
	}
	return out;
}
const FILES = sourceFiles();
const read = (p: string) => readFileSync(p, "utf8");
/** Source with comments removed — explanations that name classes are not consumers. */
const code = (p: string) =>
	read(p)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
const rel = (p: string) => p.slice(p.indexOf("/src/") + 5);

/**
 * The COMPLETE allowlist of files allowed to declare typography outside the generated classes: the
 * mapping layers, and the three third-party integrations that configure their own text rendering.
 */
const PRIMITIVE_ALLOWLIST = new Set([
	"index.css",
	"styles/tokens.css",
	"styles/global.css",
	"panels/monacoSetup.ts",
	"panels/TerminalInstance.tsx",
	"chat/tools/visualize/mermaid.ts",
]);

const componentFiles = () => FILES.filter((p) => !PRIMITIVE_ALLOWLIST.has(rel(p)));

describe("component usage", () => {
	it("has no arbitrary font-size or leading values", () => {
		const offenders: string[] = [];
		for (const path of componentFiles())
			for (const m of read(path).matchAll(/(?<![-\w])(text-\[[^\]]+\]|leading-\[[^\]]+\])/g))
				offenders.push(`${rel(path)}: ${m[1]}`);
		expect(offenders).toEqual([]);
	});

	it("has no direct font-family declarations", () => {
		const offenders: string[] = [];
		for (const path of componentFiles()) {
			const src = read(path);
			for (const m of src.matchAll(/font-\[var\(--font[a-z-]*\)\]|font-\(family-name:--[a-z-]+\)/g))
				offenders.push(`${rel(path)}: ${m[0]}`);
			if (/\bfont-family:/.test(src)) offenders.push(`${rel(path)}: font-family declaration`);
		}
		expect(offenders).toEqual([]);
	});

	/**
	 * Every `text-<size>` tier is retired — none is mapped in `index.css` any more, so writing one now
	 * silently falls back to Tailwind's own default scale (or, for `text-md`, to nothing at all).
	 * `text-mono` / `text-base-mono` / `text-brand` / `text-eyebrow` were hand-written utilities that no
	 * longer exist. `font-sans` / `font-mono` DO still resolve — `index.css` maps them so Tailwind's
	 * preflight uses our faces — but naming a family at a call site is not how type is chosen here.
	 * All of them are replaced by a generated semantic class.
	 */
	it("has no retired typography utilities", () => {
		const retired =
			/(?<![-\w])(text-mono|text-base-mono|text-brand|text-eyebrow|text-xs|text-sm|text-base|text-md|text-lg|text-xl|text-2xl|font-sans|font-mono|font-serif)(?![-\w])/g;
		const offenders: string[] = [];
		for (const path of componentFiles())
			for (const m of code(path).matchAll(retired)) offenders.push(`${rel(path)}: ${m[1]}`);
		expect(offenders).toEqual([]);
	});

	it("has no composed typography (weight/tracking/transform next to a size)", () => {
		const offenders: string[] = [];
		for (const path of componentFiles())
			for (const m of code(path).matchAll(
				/(?<![-\w])(font-(?:medium|semibold|bold|extrabold)|tracking-[a-z]+)(?![-\w])/g,
			))
				offenders.push(`${rel(path)}: ${m[1]}`);
		expect(offenders).toEqual([]);
	});

	/**
	 * A `tr-*` class that the generator does not emit is invisible at runtime: Tailwind does not know
	 * it, so no rule is produced and the element silently renders with inherited type. This is exactly
	 * how `text-eyebrow` survived a rename. Compare every `tr-…` token in the source against the
	 * generated stylesheet.
	 */
	it("names only classes the generator actually emits", () => {
		const generated = read(join(SRC, "styles/generated/typography.css"));
		const emitted = new Set([...generated.matchAll(/^\.(tr-[a-z0-9-]+)/gm)].map((m) => m[1]));
		const offenders: string[] = [];
		for (const path of FILES) {
			if (rel(path).startsWith("styles/generated/")) continue;
			// A complete class token: no trailing `-`, so a doc pattern (`tr-prose-*`) or an interpolated
			// DOM id (`tr-mermaid-${n}`) is not mistaken for one.
			for (const m of code(path).matchAll(/(?<![-\w.])(tr-[a-z0-9]+(?:-[a-z0-9]+)*)(?![-\w])/g)) {
				const cls = m[1] as string;
				// `--tr-*` custom properties are tokens, not classes; the allowlisted integrations read them.
				if (generated.includes(`--${cls}`)) continue;
				if (!emitted.has(cls)) offenders.push(`${rel(path)}: .${cls} is not generated`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("emits no semantic style without a legitimate consumer", () => {
		const styles = allStyles(typography);
		const textStyles = styles.filter((style) => !style.prose);
		const byId = new Map(textStyles.map((style) => [style.id, style]));
		const source = FILES.map(code).join("\n");
		const namedClasses = new Set(
			[...source.matchAll(/(?<![-\w.])(tr-[a-z0-9]+(?:-[a-z0-9]+)*)(?![-\w])/g)].map(
				(match) => match[1] as string,
			),
		);
		const proseSystems = Object.keys(typography.proseSystems);
		const mountedProse = new Set(
			proseSystems.filter((system) => namedClasses.has(proseRootClassName(typography, system))),
		);
		expect(proseSystems.filter((system) => !mountedProse.has(system))).toEqual([]);

		// Reachability roots: the body base, every mounted prose selector's target, and classes named by
		// shipped source. Following references also keeps a canonical target live when a live alias uses it.
		const live = new Set<string>([typography.rootStyle.$ref]);
		for (const style of styles) {
			if (style.prose && style.ref && mountedProse.has(style.group)) live.add(style.ref);
			if (!style.prose && namedClasses.has(styleClassName(typography, style.group, style.name)))
				live.add(style.id);
		}
		const queue = [...live];
		for (let index = 0; index < queue.length; index++) {
			const ref = byId.get(queue[index] as string)?.ref;
			if (ref && !live.has(ref)) {
				live.add(ref);
				queue.push(ref);
			}
		}

		expect(textStyles.filter((style) => !live.has(style.id)).map((style) => style.id)).toEqual([]);
	});

	/**
	 * `<pre>` and `<code>` are the one place "no class" is not neutral: Tailwind's preflight targets
	 * them directly with the OS monospace stack, and a directly-matching rule beats the family a parent
	 * would otherwise pass down. So a `<pre>` inside a `tr-code-text` container renders in a *different*
	 * mono face unless it names a style itself. Either carry a `tr-` class or sit inside a prose system.
	 */
	it("gives every <pre> and <code> element its own typography class", () => {
		const proseRoots = Object.keys(typography.proseSystems).map((s) =>
			proseRootClassName(typography, s),
		);
		const offenders: string[] = [];
		for (const path of componentFiles()) {
			const src = code(path);
			// The prose systems own every `pre`/`code` a markdown renderer produces.
			if (proseRoots.some((root) => src.includes(root))) continue;
			for (const m of src.matchAll(/<(pre|code)\b([^>]*)>/g)) {
				const attrs = m[2] ?? "";
				if (!/\btr-(code|text|title|prose)[a-z0-9-]*/.test(attrs))
					offenders.push(`${rel(path)}: <${m[1]}> without a typography class`);
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("markdown prose systems", () => {
	const chat = code(join(SRC, "chat/Markdown.tsx"));
	const preview = code(join(SRC, "panels/MarkdownPreview.tsx"));

	it("gives each markdown surface exactly one generated prose system", () => {
		expect(chat).toContain(proseRootClassName(typography, "chat"));
		expect(preview).toContain(proseRootClassName(typography, "doc"));
		// Not both on one surface — two prose roots on one element is an ordering coin-flip.
		expect(chat).not.toContain(proseRootClassName(typography, "doc"));
		expect(preview).not.toContain(proseRootClassName(typography, "chat"));
	});

	it("leaves no per-surface prose typography selectors", () => {
		// `[&_h1]:text-…`-style typography overrides are what the generated systems replace.
		const perElementType =
			/\[&[^\]]*\]:(?:text-(?!primary|muted|hint|text|balance|pretty|left|center|right)|font-|leading-|tracking-)/g;
		for (const [label, src] of [
			["chat/Markdown.tsx", chat],
			["panels/MarkdownPreview.tsx", preview],
		] as const)
			expect(
				[...src.matchAll(perElementType)].map((m) => m[0]),
				label,
			).toEqual([]);
	});

	it("defines the chat hierarchy only in the JSON", () => {
		const expected = {
			h1: { fontSize: "s18", fontWeight: "semibold" },
			h2: { fontSize: "s14", fontWeight: "semibold" },
			h3: { fontSize: "s12", fontWeight: "semibold" },
			h4: { fontSize: "s12", fontWeight: "medium" },
			h5: { fontSize: "s12", fontWeight: "medium" },
			h6: { fontSize: "s10", fontWeight: "medium", textTransform: "uppercase" },
			inlineCode: { fontFamily: "code", fontSize: "s13" },
			codeBlock: { fontFamily: "code", fontSize: "s13" },
			tableBody: { fontSize: "s12", fontWeight: "light" },
			tableHeader: { fontSize: "s12", fontWeight: "semibold" },
		};
		for (const [name, shape] of Object.entries(expected))
			expect(resolveStyle(typography, `chat.${name}`), `chat.${name}`).toMatchObject(shape);
	});

	/**
	 * The document surface is the one that must read as a document: a rendered README needs headings
	 * that are visibly bigger than its paragraphs. The chat scale (h2 == body, h3–h5 < body) is right
	 * for a bubble and wrong here, which is why `doc` exists at all.
	 */
	it("gives the document surface headings larger than its body text", () => {
		const px = (id: string) => typography.fontSizes[resolveStyle(typography, id).fontSize];
		const body = px("doc.body") as number;
		expect(body).toBe(14);
		expect(px("doc.h1")).toBe(24);
		expect(px("doc.h2")).toBe(20);
		expect(px("doc.h3")).toBe(18);
		expect(px("doc.h4")).toBe(16);
		for (const level of ["h1", "h2", "h3", "h4"])
			expect(px(`doc.${level}`), `doc.${level} > body`).toBeGreaterThan(body);
		// h5 sits at body size and h6 below it — both carry their weight/transform instead, the
		// convention every markdown renderer settles on. They must still never grow past the level above.
		const ladder = ["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => px(`doc.${h}`) as number);
		for (let i = 1; i < ladder.length; i++)
			expect(ladder[i], `doc.h${i + 1} <= doc.h${i}`).toBeLessThanOrEqual(ladder[i - 1] as number);
		// Chat and document fenced code now share one 13px mono size; document code is never smaller.
		expect(px("doc.codeBlock")).toBeGreaterThanOrEqual(px("chat.codeBlock") as number);
	});
});
