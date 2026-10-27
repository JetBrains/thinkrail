import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isImeComposing, yieldEscapeToIme } from "./keyboard";

function escapeEvent(init: { isComposing: boolean; keyCode: number }) {
	let prevented = false;
	const event = {
		key: "Escape",
		...init,
		preventDefault: () => {
			prevented = true;
		},
	} as unknown as KeyboardEvent;
	return { event, prevented: () => prevented };
}

describe("isImeComposing", () => {
	test("an event inside a composition belongs to the IME", () => {
		expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true);
	});

	test("the 229 sentinel belongs to the IME after compositionend already fired", () => {
		expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
	});

	test("an ordinary key is the field's own", () => {
		expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
		expect(isImeComposing({ isComposing: false, keyCode: 27 })).toBe(false);
	});
});

describe("yieldEscapeToIme", () => {
	test("a composing Escape keeps the layer open and skips the caller's handler", () => {
		for (const init of [
			{ isComposing: true, keyCode: 27 },
			{ isComposing: false, keyCode: 229 },
		]) {
			const calls: KeyboardEvent[] = [];
			const { event, prevented } = escapeEvent(init);
			yieldEscapeToIme((e) => calls.push(e))(event);
			expect(prevented()).toBe(true);
			expect(calls).toEqual([]);
		}
	});

	test("an ordinary Escape reaches the caller and leaves dismissal to Radix", () => {
		const calls: KeyboardEvent[] = [];
		const { event, prevented } = escapeEvent({ isComposing: false, keyCode: 27 });
		yieldEscapeToIme((e) => calls.push(e))(event);
		expect(calls).toEqual([event]);
		expect(prevented()).toBe(false);
	});

	test("an ordinary Escape without a caller handler is left untouched", () => {
		const { event, prevented } = escapeEvent({ isComposing: false, keyCode: 27 });
		yieldEscapeToIme(undefined)(event);
		expect(prevented()).toBe(false);
	});
});

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EXTENSIONS = join(ROOT, "thinkrail-extensions");
const SOURCE_ROOTS = [
	join(ROOT, "apps/web/src"),
	join(ROOT, "packages/ui"),
	join(ROOT, "packages/resource-renderers/src"),
	...readdirSync(EXTENSIONS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(EXTENSIONS, entry.name, "web"))
		.filter((path) => existsSync(path)),
];

const KEY_HANDLER = /onKeyDown|onKeyUp|addEventListener\(\s*["']key(?:down|up)/;
const TEXT_FIELD = /<input\b|<textarea\b|<Textarea\b|HTMLInputElement|HTMLTextAreaElement/;

const UNGUARDED_BY_DESIGN: Record<string, string> = {
	"apps/web/src/panels/ProjectTree.tsx":
		"its rename inputs spread workspaceActions' guarded inputProps; its own onKeyDown opens a row's context menu",
};

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules") continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			out.push(...sourceFiles(path));
			continue;
		}
		if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
	}
	return out;
}

function handlesTextFieldKeys(source: string): boolean {
	return KEY_HANDLER.test(source) && TEXT_FIELD.test(source);
}

describe("text-field key handlers yield to an active IME", () => {
	const files = SOURCE_ROOTS.flatMap(sourceFiles).map((path) => ({
		path: relative(ROOT, path),
		source: readFileSync(path, "utf8"),
	}));

	test("a file that handles keys on a text field checks isImeComposing", () => {
		const offenders = files
			.filter(({ path, source }) => handlesTextFieldKeys(source) && !(path in UNGUARDED_BY_DESIGN))
			.filter(({ source }) => !source.includes("isImeComposing"))
			.map(({ path }) => path);
		expect(offenders).toEqual([]);
	});

	test("every allow-listed file still handles text-field keys without the guard", () => {
		const stale = Object.keys(UNGUARDED_BY_DESIGN).filter((path) => {
			const file = files.find((candidate) => candidate.path === path);
			return !file || !handlesTextFieldKeys(file.source) || file.source.includes("isImeComposing");
		});
		expect(stale).toEqual([]);
	});
});
