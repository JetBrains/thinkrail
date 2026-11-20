import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ARROW_TWIN_COMMANDS,
	ariaKeyShortcuts,
	type ChordPressEvent,
	chordCaps,
	chordPressed,
	codeLabel,
	hasPlatformModifier,
	isApplePlatform,
	isImeComposing,
	isTypingChord,
	twinArrow,
	yieldEscapeToIme,
} from "./keyboard";

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

describe("the platform modifier", () => {
	test("is Cmd on Apple platforms and Ctrl elsewhere, never both", () => {
		expect(isApplePlatform("MacIntel")).toBe(true);
		expect(isApplePlatform("iPhone")).toBe(true);
		expect(isApplePlatform("Win32")).toBe(false);
		const cmd = { metaKey: true, ctrlKey: false };
		const ctrl = { metaKey: false, ctrlKey: true };
		expect(hasPlatformModifier(cmd, "MacIntel")).toBe(true);
		expect(hasPlatformModifier(ctrl, "MacIntel")).toBe(false);
		expect(hasPlatformModifier(ctrl, "Linux x86_64")).toBe(true);
		expect(hasPlatformModifier(cmd, "Win32")).toBe(false);
		expect(hasPlatformModifier({ metaKey: true, ctrlKey: true }, "MacIntel")).toBe(false);
	});
});

const press = (code: string, init: Partial<ChordPressEvent> = {}): ChordPressEvent => ({
	code,
	key: "",
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...init,
});

describe("chordPressed", () => {
	test("matches the physical key with exact modifiers, Mod being Cmd on Apple and Ctrl elsewhere", () => {
		const submit = { code: "Enter", key: "↵", mod: true };
		expect(chordPressed(submit, press("Enter", { metaKey: true }), "MacIntel")).toBe(true);
		expect(chordPressed(submit, press("Enter", { ctrlKey: true }), "MacIntel")).toBe(false);
		expect(chordPressed(submit, press("Enter", { ctrlKey: true }), "Win32")).toBe(true);
		expect(chordPressed(submit, press("Enter", { ctrlKey: true, shiftKey: true }), "Win32")).toBe(
			false,
		);
	});

	test("a letter matches by code whatever the layout types, and Shift only when asked to ignore it", () => {
		const discuss = { code: "KeyD", key: "D" };
		expect(chordPressed(discuss, press("KeyD", { key: "в" }), "Linux x86_64")).toBe(true);
		expect(chordPressed(discuss, press("KeyE", { key: "d" }), "Linux x86_64")).toBe(false);
		const shifted = press("KeyD", { key: "D", shiftKey: true });
		expect(chordPressed(discuss, shifted, "Linux x86_64")).toBe(false);
		expect(chordPressed(discuss, shifted, "Linux x86_64", { ignoreShift: true })).toBe(true);
		const shiftedChord = { ...discuss, shift: true };
		expect(chordPressed(shiftedChord, shifted, "Linux x86_64")).toBe(true);
		expect(
			chordPressed(shiftedChord, press("KeyD", { key: "d" }), "Linux x86_64", {
				ignoreShift: true,
			}),
		).toBe(false);
	});

	test("a typed chord matches the character, and no Alt chord fires under AltGraph off Apple", () => {
		const help = { typed: true, key: "?", mod: true };
		expect(
			chordPressed(
				help,
				press("Digit7", { key: "?", ctrlKey: true, shiftKey: true }),
				"Linux x86_64",
			),
		).toBe(true);
		const altGraph = {
			...press("KeyN", { ctrlKey: true, altKey: true }),
			getModifierState: (key: string) => key === "AltGraph",
		};
		expect(chordPressed({ code: "KeyN", key: "N", mod: true, alt: true }, altGraph, "Win32")).toBe(
			false,
		);
	});
});

describe("caps and aria-keyshortcuts", () => {
	test("caps spell the modifiers per platform; codes read as their US labels", () => {
		expect(chordCaps({ key: "↵", mod: true, shift: true }, "MacIntel")).toEqual(["⇧", "⌘", "↵"]);
		expect(chordCaps({ key: "↵", mod: true, shift: true }, "Win32")).toEqual([
			"Ctrl",
			"Shift",
			"↵",
		]);
		expect([
			codeLabel("KeyD"),
			codeLabel("Digit4"),
			codeLabel("Semicolon"),
			codeLabel("Escape"),
		]).toEqual(["D", "4", ";", "Esc"]);
	});

	test("aria-keyshortcuts names one platform's modifiers, never both Meta and Control", () => {
		const chords = [
			{ code: "Enter", key: "↵", mod: true },
			{ code: "NumpadEnter", key: "Num ↵", mod: true },
			{ code: "Escape", key: "Esc", shift: true },
			{ code: "KeyD", key: "D" },
			{ code: "Space", key: "Space" },
		];
		expect(ariaKeyShortcuts(chords, "MacIntel")).toBe("Meta+Enter Shift+Escape D Space");
		expect(ariaKeyShortcuts(chords, "Linux x86_64")).toBe("Control+Enter Shift+Escape D Space");
		expect(ariaKeyShortcuts([{ code: "Semicolon", key: ";", mod: true, alt: true }], "Win32")).toBe(
			"Control+Alt+;",
		);
	});
});

test("a typing chord has no Mod, Ctrl or Alt and is neither Escape nor an F-key", () => {
	expect(isTypingChord({ code: "KeyS", key: "S" })).toBe(true);
	expect(isTypingChord({ code: "KeyS", key: "S", shift: true })).toBe(true);
	expect(isTypingChord({ code: "Delete", key: "Delete" })).toBe(true);
	expect(isTypingChord({ code: "Escape", key: "Esc", shift: true })).toBe(false);
	expect(isTypingChord({ code: "F2", key: "F2" })).toBe(false);
	expect(isTypingChord({ code: "Enter", key: "↵", mod: true })).toBe(false);
});

test("the arrow twins are H/J/K/L by physical key, one per arrow", () => {
	expect(
		ARROW_TWIN_COMMANDS.map(({ id, arrow, chords }) => [id, arrow, chords.map(({ code }) => code)]),
	).toEqual([
		["arrows.left", "ArrowLeft", ["KeyH"]],
		["arrows.down", "ArrowDown", ["KeyJ"]],
		["arrows.up", "ArrowUp", ["KeyK"]],
		["arrows.right", "ArrowRight", ["KeyL"]],
	]);
	expect(twinArrow("arrows.down")).toBe("ArrowDown");
	expect(twinArrow("trees.search")).toBeUndefined();
	expect(twinArrow(null)).toBeUndefined();
});

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
	"apps/web/src/panels/ArtifactsPanel.tsx":
		"its rename input spreads workspaceActions' guarded inputProps; its only onKeyDown opens a row's context menu",
	"apps/web/src/panels/ArtifactsOutputs.tsx":
		"its rename input spreads workspaceActions' guarded inputProps; its only onKeyDown opens a row's context menu",
	"apps/web/src/panels/ArtifactsTree.tsx":
		"its rename inputs spread workspaceActions' guarded inputProps; its only onKeyDown is a row's menu, Delete and F2 keys",
	"packages/resource-renderers/src/renderers/VisualDiff.tsx":
		"its only key handler is the swipe divider slider (swipeDividerValue yields to an IME); its only input is the onion opacity range",
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
		path: relative(ROOT, path).replaceAll("\\", "/"),
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
