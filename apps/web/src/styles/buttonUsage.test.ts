import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { designSourceFiles, designSourceLabel } from "../../scripts/designSources";
import { normalizeEol } from "../../scripts/generatedFiles";

// Adoption guard for the button system; rules live in packages/ui/SPEC.md (Button system).

const code = (path: string) =>
	normalizeEol(readFileSync(path, "utf8"))
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
const FILES = designSourceFiles().filter((f) => f.endsWith(".tsx"));
const BUTTON_SOURCE = "packages/ui/button.tsx";

/** Every `<Tag …>` opening tag (attributes may span lines) with its 1-based line number. */
function openingTags(src: string, tag: string): { text: string; line: number }[] {
	const out: { text: string; line: number }[] = [];
	const re = new RegExp(`<${tag}(?=[\\s>/])`, "g");
	for (const m of src.matchAll(re)) {
		let depth = 0;
		let i = (m.index ?? 0) + tag.length + 1;
		for (; i < src.length; i++) {
			const ch = src[i];
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
			else if (ch === ">" && depth === 0) break;
		}
		out.push({ text: src.slice(m.index, i + 1), line: src.slice(0, m.index).split("\n").length });
	}
	return out;
}

/** The literal class text an opening tag carries (className strings, cn()/template pieces, and resolved local consts). */
function classText(tag: string, src: string): string {
	const attr = tag.match(/className=(?:"([^"]*)"|\{([\s\S]*)\})/);
	if (!attr) return "";
	if (attr[1] !== undefined) return attr[1];
	const expr = attr[2] ?? "";
	const literals = [...expr.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
	const consts = [...expr.matchAll(/\b([A-Z][A-Z0-9_]+)\b/g)].map((m) => {
		const def = src.match(new RegExp(`const ${m[1]}\\s*=\\s*([\\s\\S]*?);\\n`));
		return def ? [...def[1].matchAll(/["'`]([^"'`]*)["'`]/g)].map((x) => x[1]).join(" ") : "";
	});
	return [...literals, ...consts].join(" ");
}

const base = (token: string) => token.split(":").pop() ?? token;
/** Call-site className on Button/IconButton may position the button (and lift a floating one with an elevation token), never shape or skin it. */
const SKIN =
	/^(-?(h|size|min-h|max-h)-|p[trblxyse]?-\S|gap-|rounded|bg-|text-(?!left|right|center|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)|border|tr-|ring|outline|shadow(?!-\[var\(--shadow-)|font-|leading-|tracking-|transition|duration-|cursor-|inline-flex$|items-|justify-(?!self)|whitespace-|select-)/;
const REVEAL = /^(opacity-0|opacity-100)$/;

describe("button system adoption", () => {
	it("uses only the five variants and three sizes", () => {
		const legacy =
			/\b(variant\s*[=:]\s*\{?\s*["'](default|soft)["']|size\s*[=:]\s*\{?\s*["'](sm|icon|default|lg)["'])/;
		const bad: string[] = [];
		for (const f of FILES) {
			const src = code(f);
			for (const tag of ["Button", "IconButton"])
				for (const t of openingTags(src, tag))
					if (legacy.test(t.text)) bad.push(`${designSourceLabel(f)}:${t.line}`);
			for (const m of src.matchAll(/buttonVariants\(\{[^}]*\}\)/g))
				if (legacy.test(m[0]))
					bad.push(`${designSourceLabel(f)}:${src.slice(0, m.index).split("\n").length}`);
		}
		expect(bad).toEqual([]);
	});

	it("keeps geometry and state skins out of call-site classNames", () => {
		const bad: string[] = [];
		for (const f of FILES) {
			if (f.endsWith(BUTTON_SOURCE)) continue;
			const src = code(f);
			for (const tag of ["Button", "IconButton"])
				for (const t of openingTags(src, tag)) {
					const skins = classText(t.text, src)
						.split(/\s+/)
						.filter(Boolean)
						.filter((c) => SKIN.test(base(c)) && !REVEAL.test(base(c)));
					const label = designSourceLabel(f);
					if (OVERRIDES.some((o) => label === o.file && t.text.includes(o.contains))) continue;
					if (skins.length) bad.push(`${label}:${t.line} ${skins.join(" ")}`);
				}
		}
		expect(bad).toEqual([]);
	});

	it("never re-creates a Button skin on a raw <button>", () => {
		const SIGNATURES: [string, (c: Set<string>) => boolean][] = [
			["primary fill", (c) => c.has("bg-control-primary-bg") || c.has("bg-primary")],
			["destructive fill", (c) => c.has("bg-control-destructive-bg") || c.has("bg-feedback-error")],
			["soft-primary tint", (c) => c.has("bg-primary-subtle") && c.has("text-primary")],
			["outline skin", (c) => c.has("border-control-border-default") && c.has("bg-control-bg")],
			[
				"icon-button skin",
				(c) =>
					c.has("hover:bg-control-bg-hovered") &&
					c.has("justify-center") &&
					[...c].some((x) => /^(size-(20|24|28|32)|w-panel-header-row)$/.test(x)),
			],
		];
		const bad: string[] = [];
		for (const f of FILES) {
			const label = designSourceLabel(f);
			if (f.endsWith(BUTTON_SOURCE)) continue;
			const src = code(f);
			for (const t of openingTags(src, "button")) {
				const site = `${label}:${t.line}`;
				if (SPECIALIZED.some((s) => label === s.file && t.text.includes(s.contains))) continue;
				const c = new Set(classText(t.text, src).split(/\s+/).filter(Boolean));
				const hit = SIGNATURES.find(([, test]) => test(c));
				if (hit) bad.push(`${site} (${hit[0]})`);
			}
		}
		expect(bad).toEqual([]);
	});

	it("documents every exception it allows, and every exception still exists", () => {
		for (const x of [...SPECIALIZED, ...OVERRIDES]) {
			expect(x.reason.length).toBeGreaterThan(10);
			const file = FILES.find((f) => designSourceLabel(f) === x.file);
			expect(file, x.file).toBeDefined();
			expect(code(file as string).includes(x.contains), `${x.file}: ${x.contains}`).toBe(true);
		}
	});
});

interface Exception {
	file: string;
	/** Text unique to the opening tag (usually its data-testid). */
	contains: string;
	reason: string;
}

/** Raw <button>s that carry a skin-like class list but are specialized controls with their own behaviour. */
const SPECIALIZED: Exception[] = [
	{
		file: "auth/LoginDialog.tsx",
		contains: 'data-testid="login-option"',
		reason: "sign-in method choice rows: multi-line, left-aligned option cards, not actions",
	},
	{
		file: "chat/tools/AskUserQuestionCard.tsx",
		contains: 'data-testid="ask-tab"',
		reason: "question pager tabs (role=tab) of the ask-user-question card",
	},
	{
		file: "panels/SettingsDialog.tsx",
		contains: "data-testid={`settings-nav-",
		reason: "Settings section navigation tabs with a persistent selected state",
	},
	{
		file: "panels/SettingsSwitch.tsx",
		contains: 'role="switch"',
		reason:
			"a switch (role=switch), not a button; consolidation with packages/ui Switch is tracked separately (audit F-04)",
	},
	{
		file: "panels/TemplatesSettings.tsx",
		contains: 'data-testid="template-delete"',
		reason: "red-on-hover icon action: no button variant matches a transparent red-text action yet",
	},
	{
		file: "packages/resource-renderers/src/renderers/RegionReviewSurface.tsx",
		contains: 'data-testid="region-comment-marker"',
		reason: "numbered comment pin (round badge positioned on the region), not an action button",
	},
	{
		file: "packages/resource-renderers/src/renderers/VisualDiff.tsx",
		contains: "DIVIDER_LABELS",
		reason: "swipe-comparison divider handle, not an action button",
	},
	{
		file: "packages/resource-renderers/src/renderers/csv/Diff.tsx",
		contains: "viewer.region.showComment",
		reason: "numbered comment pin (round badge) in a CSV diff cell",
	},
	{
		file: "packages/resource-renderers/src/renderers/csv/View.tsx",
		contains: "viewer.region.showComment",
		reason: "numbered comment pin (round badge) in a CSV cell",
	},
	{
		file: "packages/resource-renderers/src/renderers/json/JsonTree.tsx",
		contains: "viewer.region.showComment",
		reason: "numbered comment pin (round badge) on a JSON tree row",
	},
];

/** Button / IconButton call sites allowed to carry a skin class, each with the decision that needs it. */
const OVERRIDES: Exception[] = [
	{
		file: "chat/ExtUiPrompt.tsx",
		contains: 'data-testid="ext-ui-option"',
		reason:
			"extension select options must wrap long labels (chat/SPEC.md); the only multi-line button",
	},
	{
		file: "chat/resources/ResourcesButton.tsx",
		contains: 'data-testid="resources-mcp-attention"',
		reason: "amber attention action: no button variant carries a warning-coloured label yet",
	},
	{
		file: "chat/resources/ResourcesInspector.tsx",
		contains: 'data-testid="resource-detail-stop"',
		reason: "red-text Stop action: no button variant matches a red-text outline action yet",
	},
	{
		file: "chat/resources/ResourcesInspector.tsx",
		contains: 'data-testid="resources-stop-all"',
		reason: "red-text Stop all action: no button variant matches a red-text ghost action yet",
	},
];
