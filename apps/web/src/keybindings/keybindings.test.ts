import { describe, expect, test } from "bun:test";
import {
	FOCUS_GROUP_BINDINGS,
	isBrowserReservedChord,
	isDesktopNativeChord,
	isPlainChord,
	KEYBINDINGS,
	type KeybindingId,
	keybindingLabel,
	keybindingLabels,
	keybindingShortcut,
	LOCAL_KEY_DEFAULTS,
	matchKeybinding,
	resolveKeybindings,
} from ".";

const defaults = (platform = "") => resolveKeybindings({ platform });
const match = (event: Parameters<typeof matchKeybinding>[1], platform = "") =>
	matchKeybinding(defaults(platform), event);
const shown = (id: KeybindingId, { browser = false, platform = "" } = {}) =>
	keybindingShortcut(defaults(platform), id, { browser });
const label = (id: KeybindingId, { browser = false, platform = "" } = {}) =>
	keybindingLabel(defaults(platform), id, { browser });
const labels = (id: KeybindingId, platform = "") => keybindingLabels(defaults(platform), id);

type Modifiers = Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>>;

type Chord = (typeof KEYBINDINGS)[KeybindingId][number];

const PLATFORMS = {
	apple: "MacIntel",
	windows: "Win32",
	linux: "Linux x86_64",
	other: "",
} as const;

const press = (code: string, modifiers: Modifiers = {}, key = "") => ({
	code,
	key,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
});

const withAltGraph = (event: ReturnType<typeof press>) => ({
	...event,
	getModifierState: (key: string) => key === "AltGraph",
});

const entries = Object.entries(KEYBINDINGS) as [KeybindingId, (typeof KEYBINDINGS)[KeybindingId]][];

describe.each(Object.entries(PLATFORMS))("keybindings on %s", (family, platform) => {
	const mod: Modifiers = family === "apple" ? { metaKey: true } : { ctrlKey: true };
	const other: Modifiers = family === "apple" ? { ctrlKey: true } : { metaKey: true };

	test("every app chord matches its binding on the physical key", () => {
		expect(match(press("KeyB", mod), platform)).toBe("view.toggleLeft");
		expect(match(press("KeyJ", mod), platform)).toBe("view.toggleRight");
		expect(match(press("KeyJ", { ...mod, shiftKey: true }), platform)).toBe("view.toggleBottom");
		expect(match(press("F12", { ...mod, shiftKey: true }), platform)).toBe("view.toggleAllPanels");
		expect(match(press("KeyK", mod), platform)).toBe("search.open");
		expect(match(press("KeyF", { ...mod, shiftKey: true }), platform)).toBe("files.findInFiles");
		expect(match(press("KeyR", { ctrlKey: true }), platform)).toBe("chat.history");
	});

	test("Mod+N and its Mod+Alt+N alias both start a workspace, never with Shift", () => {
		expect(match(press("KeyN", mod), platform)).toBe("workspace.new");
		expect(match(press("KeyN", { ...mod, altKey: true }), platform)).toBe("workspace.new");
		expect(match(press("KeyN", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(match(press("KeyN", { ...mod, shiftKey: true, altKey: true }), platform)).toBeNull();
	});

	test("Mod+K rejects Shift and Alt, and Alt belongs only to the listed aliases, tab moves and chip keys", () => {
		const altBindings = entries
			.filter(([, chords]) => chords.some((chord: Chord) => chord.alt === true))
			.map(([id]) => id)
			.filter((id) => !id.startsWith("suggestions."))
			.sort();
		expect(altBindings).toEqual([
			"tab.close",
			"tab.moveToNextGroup",
			"tab.moveToPreviousGroup",
			"workspace.new",
		]);
		const chipKeys = entries.filter(([id]) => id.startsWith("suggestions."));
		expect(chipKeys).toHaveLength(18);
		expect(
			chipKeys.every(([, chords]) =>
				chords.every((chord: Chord) => chord.alt === true && !chord.mod && !chord.ctrl),
			),
		).toBe(true);
		expect(match(press("Digit1", { altKey: true }), platform)).toBe("suggestions.send1");
		expect(match(press("Digit9", { altKey: true, shiftKey: true }), platform)).toBe(
			"suggestions.edit9",
		);
		expect(match(press("Digit1", { ...mod, altKey: true }), platform)).toBeNull();
		expect(match(press("KeyK", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(match(press("KeyK", { ...mod, altKey: true }), platform)).toBeNull();
		expect(match(press("KeyB", { ...mod, altKey: true }), platform)).toBeNull();
		expect(match(press("KeyJ", { ...mod, altKey: true }), platform)).toBeNull();
		expect(match(press("KeyJ", { ...mod, shiftKey: true, altKey: true }), platform)).toBeNull();
		expect(match(press("KeyF", { ...mod, shiftKey: true, altKey: true }), platform)).toBeNull();
	});

	test("Mod+Alt+W closes a tab and Mod+\\ splits right, while Mod+W stays the native owner's", () => {
		expect(match(press("KeyW", { ...mod, altKey: true }), platform)).toBe("tab.close");
		expect(match(press("KeyW", mod), platform)).toBeNull();
		expect(match(press("KeyW", { ...mod, altKey: true, shiftKey: true }), platform)).toBeNull();
		expect(match(press("Backslash", mod), platform)).toBe("group.splitRight");
		expect(match(press("Backslash", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(match(press("Backslash", { ...mod, altKey: true }), platform)).toBeNull();
	});

	test("move a tab with Ctrl+Cmd+arrows on Apple and Ctrl+Alt+arrows elsewhere", () => {
		const move: Modifiers =
			family === "apple" ? { ctrlKey: true, metaKey: true } : { ctrlKey: true, altKey: true };
		const foreign: Modifiers =
			family === "apple" ? { ctrlKey: true, altKey: true } : { ctrlKey: true, metaKey: true };
		expect(match(press("ArrowLeft", move), platform)).toBe("tab.moveToPreviousGroup");
		expect(match(press("ArrowRight", move), platform)).toBe("tab.moveToNextGroup");
		expect(match(press("ArrowRight", foreign), platform)).toBeNull();
		expect(match(press("ArrowRight", mod), platform)).toBeNull();
		expect(match(press("ArrowRight", { ...move, shiftKey: true }), platform)).toBeNull();
	});

	test("no Alt chord matches while AltGraph is held, except on Apple where Option reports it", () => {
		const altGr: Modifiers = { ctrlKey: true, altKey: true };
		for (const code of ["KeyN", "KeyW", "ArrowLeft", "ArrowRight"]) {
			const unguarded = family === "apple" ? match(press(code, altGr), platform) : null;
			expect(match(withAltGraph(press(code, altGr)), platform)).toBe(unguarded);
		}
		expect(match(withAltGraph(press("KeyN", { ...mod, altKey: true })), platform)).toBe(
			family === "apple" ? "workspace.new" : null,
		);
		expect(match(withAltGraph(press("KeyW", { ...mod, altKey: true })), platform)).toBe(
			family === "apple" ? "tab.close" : null,
		);
		expect(match(withAltGraph(press("KeyB", mod)), platform)).toBe("view.toggleLeft");
		expect(match(withAltGraph(press("Digit1", { altKey: true })), platform)).toBe(
			family === "apple" ? "suggestions.send1" : null,
		);
	});

	test("region, focus and tool chords match on their physical keys", () => {
		expect(match(press("F6"), platform)).toBe("region.next");
		expect(match(press("F6", { shiftKey: true }), platform)).toBe("region.previous");
		expect(match(press("KeyL", mod), platform)).toBe("focus.composer");
		expect(match(press("Digit0", mod), platform)).toBe("focus.projects");
		for (const [index, id] of FOCUS_GROUP_BINDINGS.entries()) {
			expect(match(press(`Digit${index + 1}`, mod), platform)).toBe(id);
		}
		expect(match(press("Backquote", { ctrlKey: true }), platform)).toBe("focus.terminal");
		expect(match(press("KeyE", { ...mod, shiftKey: true }), platform)).toBe("view.files");
		expect(match(press("KeyG", { ...mod, shiftKey: true }), platform)).toBe("view.changes");
	});

	test("Numpad0 and Mod+Shift+0 never focus Projects, and Ctrl+F6 stays the workbench's", () => {
		expect(match(press("Numpad0", mod), platform)).toBeNull();
		expect(match(press("Digit0", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(match(press("Digit0"), platform)).toBeNull();
		expect(match(press("F6", { ctrlKey: true }), platform)).toBeNull();
		expect(match(press("F6", { ctrlKey: true, shiftKey: true }), platform)).toBeNull();
		expect(match(press("F6", mod), platform)).toBeNull();
		expect(match(press("KeyE", mod), platform)).toBeNull();
		expect(match(press("KeyL", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(match(press("Backquote"), platform)).toBeNull();
	});

	test("a missing, extra or wrong modifier does not match", () => {
		expect(match(press("KeyB"), platform)).toBeNull();
		expect(match(press("KeyB", other), platform)).toBeNull();
		expect(match(press("KeyB", { ...mod, ...other }), platform)).toBeNull();
		expect(match(press("KeyB", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(match(press("KeyF", mod), platform)).toBeNull();
		expect(match(press("KeyR"), platform)).toBeNull();
		expect(match(press("KeyR", { ctrlKey: true, metaKey: true }), platform)).toBeNull();
		expect(match(press("KeyR", { ctrlKey: true, shiftKey: true }), platform)).toBeNull();
		expect(match(press("KeyR", { ctrlKey: true, altKey: true }), platform)).toBeNull();
		expect(match(press("KeyX", mod), platform)).toBeNull();
	});
});

test("Ctrl+R and Ctrl+` are literal Control on Apple, where Cmd+R and Cmd+` stay the system's", () => {
	expect(match(press("KeyR", { ctrlKey: true }), PLATFORMS.apple)).toBe("chat.history");
	expect(match(press("KeyR", { metaKey: true }), PLATFORMS.apple)).toBeNull();
	expect(match(press("KeyB", { ctrlKey: true }), PLATFORMS.apple)).toBeNull();
	expect(match(press("Backquote", { ctrlKey: true }), PLATFORMS.apple)).toBe("focus.terminal");
	expect(match(press("Backquote", { metaKey: true }), PLATFORMS.apple)).toBeNull();
});

test("every chord resolves to its own binding and no two bindings share a chord on a platform", () => {
	for (const platform of Object.values(PLATFORMS)) {
		const apple = platform === PLATFORMS.apple;
		const owners = new Map<string, KeybindingId>();
		for (const [id, chords] of entries) {
			for (const chord of chords as readonly Chord[]) {
				if (chord.platform !== undefined && (chord.platform === "apple") !== apple) continue;
				const event = press(
					chord.code ?? "",
					{
						ctrlKey: chord.ctrl === true || (chord.mod === true && !apple),
						metaKey: chord.mod === true && apple,
						shiftKey: chord.shift === true,
						altKey: chord.alt === true,
					},
					chord.typed ? chord.key : "",
				);
				const signature = JSON.stringify(event);
				expect(owners.get(signature) ?? id).toBe(id);
				owners.set(signature, id);
				expect(match(event, platform)).toBe(chord.displayOnly ? null : id);
			}
		}
	}
});

test("Mod+Shift+F12 hides all panels and is free everywhere else on every platform", () => {
	expect(label("view.toggleAllPanels", { platform: PLATFORMS.apple })).toBe("⇧⌘F12");
	expect(label("view.toggleAllPanels", { platform: PLATFORMS.windows })).toBe("Ctrl+Shift+F12");
	expect(label("view.toggleAllPanels", { platform: PLATFORMS.linux, browser: true })).toBe(
		"Ctrl+Shift+F12",
	);
	const [chord] = KEYBINDINGS["view.toggleAllPanels"];
	expect(isBrowserReservedChord(chord, PLATFORMS.linux)).toBe(false);
	expect(isBrowserReservedChord(chord, PLATFORMS.apple)).toBe(false);
	expect(isDesktopNativeChord(chord)).toBe(false);
	expect(isPlainChord(chord)).toBe(false);
	for (const [family, platform] of Object.entries(PLATFORMS)) {
		const mod: Modifiers = family === "apple" ? { metaKey: true } : { ctrlKey: true };
		const resolved = defaults(platform);
		expect(resolved.conflicts).toEqual([]);
		const holders = resolved.commands.filter((command) =>
			command.chords.some(
				({ chord: held }) =>
					held.code === "F12" && held.mod === true && held.shift === true && !held.alt,
			),
		);
		expect(holders.map((command) => command.id)).toEqual(["view.toggleAllPanels"]);
		for (const [scope, active] of resolved.local) {
			expect([scope, active.some(({ chord: held }) => held.code === "F12")]).toEqual([
				scope,
				false,
			]);
		}
		expect(match(press("F12"), platform)).toBeNull();
		expect(match(press("F12", { shiftKey: true }), platform)).toBeNull();
		expect(match(press("F12", mod), platform)).toBeNull();
		expect(match(press("F12", { ...mod, shiftKey: true, altKey: true }), platform)).toBeNull();
	}
});

describe("Mod+? matches the typed question mark on any layout", () => {
	const linux = PLATFORMS.linux;
	const typed = (code: string, key: string, modifiers: Modifiers) =>
		match(press(code, modifiers, key), linux);

	test("US Ctrl+Shift+/, Russian Ctrl+Shift+7 and German Ctrl+Shift+ß all type ? and open it", () => {
		const ctrlShift: Modifiers = { ctrlKey: true, shiftKey: true };
		expect(typed("Slash", "?", ctrlShift)).toBe("shortcuts.open");
		expect(typed("Digit7", "?", ctrlShift)).toBe("shortcuts.open");
		expect(typed("Minus", "?", ctrlShift)).toBe("shortcuts.open");
		expect(match(press("Slash", { metaKey: true, shiftKey: true }, "?"), PLATFORMS.apple)).toBe(
			"shortcuts.open",
		);
	});

	test("the physical Slash key does not open it where it types something else", () => {
		const ctrlShift: Modifiers = { ctrlKey: true, shiftKey: true };
		expect(typed("Slash", ",", ctrlShift)).toBeNull();
		expect(typed("Slash", "_", ctrlShift)).toBeNull();
		expect(typed("Slash", "/", { ctrlKey: true })).toBeNull();
		expect(typed("Minus", "-", { ctrlKey: true })).toBeNull();
	});

	test("Alt, a foreign modifier or no modifier never opens it", () => {
		expect(typed("Slash", "?", { shiftKey: true })).toBeNull();
		expect(typed("Slash", "?", { ctrlKey: true, shiftKey: true, altKey: true })).toBeNull();
		expect(typed("Slash", "?", { metaKey: true, shiftKey: true })).toBeNull();
		expect(
			match(press("Slash", { ctrlKey: true, shiftKey: true }, "?"), PLATFORMS.apple),
		).toBeNull();
	});

	test("is shown as Mod+?", () => {
		expect(label("shortcuts.open", { platform: PLATFORMS.apple })).toBe("⌘?");
		expect(label("shortcuts.open", { platform: PLATFORMS.windows })).toBe("Ctrl+?");
	});
});

describe("keybinding shortcuts", () => {
	test("show a binding's first chord as a display shortcut", () => {
		expect(shown("view.toggleLeft")).toEqual({ key: "B", mod: true });
		expect(shown("view.toggleRight")).toEqual({ key: "J", mod: true });
		expect(shown("view.toggleBottom")).toEqual({ key: "J", mod: true, shift: true });
		expect(shown("view.toggleAllPanels")).toEqual({ key: "F12", mod: true, shift: true });
		expect(shown("search.open")).toEqual({ key: "K", mod: true });
		expect(shown("files.findInFiles")).toEqual({ key: "F", mod: true, shift: true });
		expect(shown("chat.history")).toEqual({ key: "R", ctrl: true });
		expect(shown("region.next")).toEqual({ key: "F6" });
		expect(shown("region.previous")).toEqual({ key: "F6", shift: true });
		expect(shown("focus.composer")).toEqual({ key: "L", mod: true });
		expect(shown("focus.projects")).toEqual({ key: "0", mod: true });
		expect(shown("focus.group3")).toEqual({ key: "3", mod: true });
		expect(shown("focus.terminal")).toEqual({ key: "`", ctrl: true });
		expect(shown("view.files")).toEqual({ key: "E", mod: true, shift: true });
		expect(shown("view.changes")).toEqual({ key: "G", mod: true, shift: true });
		expect(shown("group.splitRight")).toEqual({ key: "\\", mod: true });
	});

	test("Close tab shows the native Mod+W on desktop and the Mod+Alt+W alias in a browser", () => {
		expect(shown("tab.close")).toEqual({ key: "W", mod: true });
		expect(shown("tab.close", { browser: true })).toEqual({
			key: "W",
			mod: true,
			alt: true,
		});
		expect(label("tab.close", { platform: PLATFORMS.apple })).toBe("⌘W");
		expect(label("tab.close", { browser: true, platform: PLATFORMS.linux })).toBe("Ctrl+Alt+W");
	});

	test("a platform-scoped chord is shown only on its platform", () => {
		expect(shown("tab.moveToNextGroup", { platform: PLATFORMS.apple })).toEqual({
			key: "→",
			ctrl: true,
			mod: true,
		});
		expect(shown("tab.moveToNextGroup", { platform: PLATFORMS.windows })).toEqual({
			key: "→",
			ctrl: true,
			alt: true,
		});
		expect(label("tab.moveToPreviousGroup", { platform: PLATFORMS.apple })).toBe("⌃⌘←");
		expect(label("tab.moveToPreviousGroup", { platform: PLATFORMS.linux })).toBe("Ctrl+Alt+←");
		expect(labels("tab.moveToNextGroup", PLATFORMS.apple)).toEqual(["⌃⌘→"]);
		expect(labels("tab.moveToNextGroup", PLATFORMS.windows)).toEqual(["Ctrl+Alt+→"]);
	});

	test("New workspace shows Mod+N where the page receives it and Mod+Alt+N in a browser", () => {
		expect(shown("workspace.new")).toEqual({ key: "N", mod: true });
		expect(shown("workspace.new", { browser: true })).toEqual({
			key: "N",
			mod: true,
			alt: true,
		});
		expect(shown("view.toggleLeft", { browser: true })).toEqual({
			key: "B",
			mod: true,
		});
	});

	test("labels name a binding's chords the way chrome spells them", () => {
		expect(label("search.open", { platform: PLATFORMS.apple })).toBe("⌘K");
		expect(label("search.open", { platform: PLATFORMS.windows })).toBe("Ctrl+K");
		expect(label("chat.history", { platform: PLATFORMS.apple })).toBe("⌃R");
		expect(label("focus.terminal", { platform: PLATFORMS.apple })).toBe("⌃`");
		expect(label("focus.terminal", { platform: PLATFORMS.linux })).toBe("Ctrl+`");
		expect(label("region.previous", { platform: PLATFORMS.windows })).toBe("Shift+F6");
		expect(label("workspace.new", { browser: true, platform: PLATFORMS.linux })).toBe("Ctrl+Alt+N");
		expect(labels("workspace.new", PLATFORMS.apple)).toEqual(["⌘N", "⌥⌘N"]);
		expect(labels("workspace.new", PLATFORMS.windows)).toEqual(["Ctrl+N", "Ctrl+Alt+N"]);
	});
});

describe("the Settings local scopes", () => {
	const SCOPES = ["settings.nav", "settings", "settings.list"] as const;
	const resolved = resolveKeybindings({ platform: PLATFORMS.linux });
	const local = (scope: string) =>
		(resolved.local.get(scope) ?? []).map(({ id, chord }) => `${id}=${chord.code}`);

	test("declare search, reset and remove, each beside the shared arrow twins", () => {
		const twins = ["arrows.left=KeyH", "arrows.down=KeyJ", "arrows.up=KeyK", "arrows.right=KeyL"];
		expect(local("settings.nav")).toEqual([
			"settings.nav.search=KeyS",
			"settings.nav.search=Slash",
			...twins,
		]);
		expect(local("settings")).toEqual(["settings.reset=Delete", ...twins]);
		expect(local("settings.list")).toEqual(["settings.list.remove=Delete", ...twins]);
		for (const scope of SCOPES) {
			expect(LOCAL_KEY_DEFAULTS[scope].map(({ id }) => id)).toEqual([
				...new Set(local(scope).map((entry) => entry.slice(0, entry.indexOf("=")))),
			]);
		}
	});

	test("hold no default conflict and leave F to hint mode", () => {
		for (const platform of Object.values(PLATFORMS)) {
			const each = resolveKeybindings({ platform });
			expect(each.conflicts).toEqual([]);
			for (const scope of SCOPES) {
				expect((each.local.get(scope) ?? []).some(({ chord }) => chord.code === "KeyF")).toBe(
					false,
				);
			}
		}
	});
});
