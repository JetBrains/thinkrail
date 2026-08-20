import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeEol } from "../../scripts/generatedFiles";
import {
	allStyles,
	loadTypography,
	proseRootClassName,
	resolveStyle,
	styleClassName,
} from "../../scripts/typography";

const typography = loadTypography();
const SRC = new URL("..", import.meta.url).pathname;

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
const read = (p: string) => normalizeEol(readFileSync(p, "utf8"));
const code = (p: string) =>
	read(p)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
const rel = (p: string) => p.slice(p.indexOf("/src/") + 5);

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

	it("names only classes the generator actually emits", () => {
		const generated = read(join(SRC, "styles/generated/typography.css"));
		const emitted = new Set([...generated.matchAll(/^\.(tr-[a-z0-9-]+)/gm)].map((m) => m[1]));
		const offenders: string[] = [];
		for (const path of FILES) {
			if (rel(path).startsWith("styles/generated/")) continue;
			for (const m of code(path).matchAll(/(?<![-\w.])(tr-[a-z0-9]+(?:-[a-z0-9]+)*)(?![-\w])/g)) {
				const cls = m[1] as string;
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

	it("gives every <pre> and <code> element its own typography class", () => {
		const proseRoots = Object.keys(typography.proseSystems).map((s) =>
			proseRootClassName(typography, s),
		);
		const offenders: string[] = [];
		for (const path of componentFiles()) {
			const src = code(path);
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
		expect(chat).not.toContain(proseRootClassName(typography, "doc"));
		expect(preview).not.toContain(proseRootClassName(typography, "chat"));
	});

	it("leaves no per-surface prose typography selectors", () => {
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
		const ladder = ["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => px(`doc.${h}`) as number);
		for (let i = 1; i < ladder.length; i++)
			expect(ladder[i], `doc.h${i + 1} <= doc.h${i}`).toBeLessThanOrEqual(ladder[i - 1] as number);
		expect(px("doc.codeBlock")).toBeGreaterThanOrEqual(px("chat.codeBlock") as number);
	});
});
