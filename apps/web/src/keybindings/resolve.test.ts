import { describe, expect, test } from "bun:test";
import {
	type ExtensionCommandSet,
	KEYBINDINGS,
	keybindingLabel,
	keybindingShortcut,
	matchKeybinding,
	resolveKeybindings,
} from ".";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";
const PLATFORMS = [MAC, LINUX, "Win32", ""];

type Modifiers = Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>>;

const press = (code: string, modifiers: Modifiers = {}, key = "") => ({
	code,
	key,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
});

const ctrl = (code: string, modifiers: Modifiers = {}) =>
	press(code, { ctrlKey: true, ...modifiers });

function extension(
	name: string,
	chords: Record<string, { code: string; key: string; mod?: true; alt?: true }[]>,
	enabled = true,
): ExtensionCommandSet {
	return {
		extension: name,
		enabled,
		commands: Object.entries(chords).map(([id, list]) => ({
			id,
			title: "hintMode.shortcuts.show",
			chords: list,
		})),
	};
}

const MOD_K = { code: "KeyK", key: "k", mod: true } as const;
const PLAIN_F = { code: "KeyF", key: "f" } as const;

describe("the resolver with no overrides", () => {
	test("lists every app command at its defaults with no conflict on any platform", () => {
		for (const platform of PLATFORMS) {
			const resolved = resolveKeybindings({ platform });
			expect(resolved.conflicts).toEqual([]);
			expect(resolved.commands.map((command) => command.id)).toEqual(Object.keys(KEYBINDINGS));
			expect(resolved.commands.every((c) => c.enabled && !c.custom && c.extension === null)).toBe(
				true,
			);
		}
	});

	test("keeps platform-scoped and display-only defaults working", () => {
		const mac = resolveKeybindings({ platform: MAC });
		const linux = resolveKeybindings({ platform: LINUX });
		expect(keybindingLabel(mac, "tab.moveToNextGroup")).toBe("⌃⌘→");
		expect(keybindingLabel(linux, "tab.moveToNextGroup")).toBe("Ctrl+Alt+→");
		expect(matchKeybinding(linux, ctrl("KeyW"))).toBeNull();
		expect(keybindingLabel(linux, "tab.close")).toBe("Ctrl+W");
	});
});

describe("user overrides", () => {
	test("replace a command's default chords on every platform, recorded with Mod", () => {
		const overrides = { "search.open": ["Mod+Alt+KeyS"] };
		const mac = resolveKeybindings({ platform: MAC, overrides });
		const linux = resolveKeybindings({ platform: LINUX, overrides });
		expect(matchKeybinding(mac, press("KeyS", { metaKey: true, altKey: true }))).toBe(
			"search.open",
		);
		expect(matchKeybinding(linux, ctrl("KeyS", { altKey: true }))).toBe("search.open");
		expect(matchKeybinding(linux, ctrl("KeyK"))).toBeNull();
		expect(keybindingLabel(mac, "search.open")).toBe("⌥⌘S");
		expect(linux.byId.get("search.open")?.custom).toBe(true);
		expect(linux.conflicts).toEqual([]);
	});

	test("an override replaces platform-scoped defaults too, the same chord on each platform", () => {
		const overrides = { "tab.moveToNextGroup": ["Mod+Alt+KeyL"] };
		for (const platform of [MAC, LINUX]) {
			const resolved = resolveKeybindings({ platform, overrides });
			const mod = platform === MAC ? { metaKey: true } : { ctrlKey: true };
			expect(matchKeybinding(resolved, press("KeyL", { ...mod, altKey: true }))).toBe(
				"tab.moveToNextGroup",
			);
			expect(
				matchKeybinding(resolved, press("ArrowRight", { ctrlKey: true, metaKey: true })),
			).toBeNull();
			expect(matchKeybinding(resolved, ctrl("ArrowRight", { altKey: true }))).toBeNull();
		}
	});

	test("an empty list unbinds the command: nothing matches and nothing is shown", () => {
		const resolved = resolveKeybindings({ platform: LINUX, overrides: { "search.open": [] } });
		expect(matchKeybinding(resolved, ctrl("KeyK"))).toBeNull();
		expect(keybindingShortcut(resolved, "search.open")).toBeUndefined();
		expect(keybindingLabel(resolved, "search.open")).toBe("");
		expect(resolved.byId.get("search.open")?.chords).toEqual([]);
	});

	test("a literal Ctrl is ⌃ on Apple and the same as Mod elsewhere", () => {
		const overrides = { "search.open": ["Ctrl+KeyU"] };
		const mac = resolveKeybindings({ platform: MAC, overrides });
		const linux = resolveKeybindings({ platform: LINUX, overrides });
		expect(matchKeybinding(mac, press("KeyU", { ctrlKey: true }))).toBe("search.open");
		expect(matchKeybinding(mac, press("KeyU", { metaKey: true }))).toBeNull();
		expect(matchKeybinding(linux, ctrl("KeyU"))).toBe("search.open");
		const twice = resolveKeybindings({
			platform: LINUX,
			overrides: { "search.open": ["Ctrl+KeyU", "Mod+KeyU"] },
		});
		expect(twice.byId.get("search.open")?.chords.map((chord) => chord.text)).toEqual(["Ctrl+KeyU"]);
	});

	test("drops malformed chords and plain keys a command does not allow, and ignores unknown ids", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: {
				"search.open": ["Mod+k", "KeyK", "Mod+Shift+KeyK"],
				"retired.command": ["Mod+KeyB"],
			},
		});
		expect(resolved.byId.get("search.open")?.chords.map((chord) => chord.text)).toEqual([
			"Mod+Shift+KeyK",
		]);
		expect(matchKeybinding(resolved, press("KeyK"), { textEntry: false })).toBeNull();
		expect(resolved.byId.has("retired.command")).toBe(false);
		expect(matchKeybinding(resolved, ctrl("KeyB"))).toBe("view.toggleLeft");
	});

	test("an override on another command's default chord takes it; that command loses only it", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "view.toggleLeft": ["Mod+KeyK"] },
		});
		expect(matchKeybinding(resolved, ctrl("KeyK"))).toBe("view.toggleLeft");
		expect(matchKeybinding(resolved, ctrl("KeyB"))).toBeNull();
		expect(resolved.conflicts).toEqual([
			{ loser: "search.open", chord: "Mod+KeyK", winner: "view.toggleLeft" },
		]);
		expect(resolved.byId.get("search.open")?.chords).toEqual([
			expect.objectContaining({ text: "Mod+KeyK", lostTo: "view.toggleLeft" }),
		]);
		expect(keybindingShortcut(resolved, "search.open")).toBeUndefined();
	});

	test("an override outranks a typed default that the same press also types", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "view.toggleLeft": ["Mod+Shift+Slash"] },
		});
		expect(matchKeybinding(resolved, ctrl("Slash", { shiftKey: true }), {})).toBe(
			"view.toggleLeft",
		);
		expect(matchKeybinding(resolved, { ...ctrl("Slash", { shiftKey: true }), key: "?" }, {})).toBe(
			"view.toggleLeft",
		);
		expect(matchKeybinding(resolved, { ...ctrl("Digit7", { shiftKey: true }), key: "?" })).toBe(
			"shortcuts.open",
		);
	});
});

describe("extension commands", () => {
	test("ThinkRail defaults beat extension defaults; the loser keeps its other chords", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			extensions: [
				extension("notes", {
					"notes.open": [MOD_K, { code: "KeyH", key: "h", mod: true, alt: true }],
				}),
			],
		});
		expect(matchKeybinding(resolved, ctrl("KeyK"))).toBe("search.open");
		expect(matchKeybinding(resolved, ctrl("KeyH", { altKey: true }))).toBe("notes.open");
		expect(resolved.conflicts).toEqual([
			{ loser: "notes.open", chord: "Mod+KeyK", winner: "search.open" },
		]);
		expect(keybindingLabel(resolved, "notes.open")).toBe("Ctrl+Alt+H");
	});

	test("between extensions the one earlier in the registry wins", () => {
		const semicolon = { code: "Semicolon", key: ";", mod: true } as const;
		const resolved = resolveKeybindings({
			platform: MAC,
			extensions: [
				extension("hint-mode", { "hint-mode.show": [semicolon] }),
				extension("timer", { "timer.start": [semicolon] }),
			],
		});
		expect(matchKeybinding(resolved, press("Semicolon", { metaKey: true }))).toBe("hint-mode.show");
		expect(resolved.conflicts).toEqual([
			{ loser: "timer.start", chord: "Mod+Semicolon", winner: "hint-mode.show" },
		]);
	});

	test("a user override on an extension command beats a ThinkRail default", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "notes.open": ["Mod+KeyB"] },
			extensions: [extension("notes", { "notes.open": [MOD_K] })],
		});
		expect(matchKeybinding(resolved, ctrl("KeyB"))).toBe("notes.open");
		expect(matchKeybinding(resolved, ctrl("KeyK"))).toBe("search.open");
		expect(resolved.conflicts).toEqual([
			{ loser: "view.toggleLeft", chord: "Mod+KeyB", winner: "notes.open" },
		]);
	});

	test("between two overrides a ThinkRail command wins, then table and registry order", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "notes.open": ["Mod+KeyU"], "search.open": ["Mod+KeyU"] },
			extensions: [extension("notes", { "notes.open": [MOD_K] })],
		});
		expect(matchKeybinding(resolved, ctrl("KeyU"))).toBe("search.open");
		expect(resolved.conflicts).toEqual([
			{ loser: "notes.open", chord: "Mod+KeyU", winner: "search.open" },
		]);
	});

	test("a disabled extension's commands are listed but neither match nor conflict", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "notes.open": ["Mod+KeyB"] },
			extensions: [extension("notes", { "notes.open": [MOD_K], "notes.close": [PLAIN_F] }, false)],
		});
		expect(resolved.byId.get("notes.open")).toMatchObject({
			extension: "notes",
			enabled: false,
			custom: true,
		});
		expect(resolved.byId.get("notes.close")?.enabled).toBe(false);
		expect(resolved.conflicts).toEqual([]);
		expect(matchKeybinding(resolved, ctrl("KeyB"))).toBe("view.toggleLeft");
		expect(matchKeybinding(resolved, press("KeyF"), { textEntry: false })).toBeNull();
	});

	test("a plain default fires only outside text entry and may be rebound to another plain key", () => {
		const hint = extension("hint-mode", { "hint-mode.show": [PLAIN_F] });
		const defaults = resolveKeybindings({ platform: LINUX, extensions: [hint] });
		expect(matchKeybinding(defaults, press("KeyF"), { textEntry: false })).toBe("hint-mode.show");
		expect(matchKeybinding(defaults, press("KeyF"), { textEntry: true })).toBeNull();
		expect(matchKeybinding(defaults, press("KeyF"))).toBeNull();
		expect(defaults.byId.get("hint-mode.show")?.plain).toBe(true);
		expect(defaults.byId.get("search.open")?.plain).toBe(false);
		const rebound = resolveKeybindings({
			platform: LINUX,
			overrides: { "hint-mode.show": ["KeyG"] },
			extensions: [hint],
		});
		expect(matchKeybinding(rebound, press("KeyG"), { textEntry: false })).toBe("hint-mode.show");
		expect(matchKeybinding(rebound, press("KeyF"), { textEntry: false })).toBeNull();
	});

	test("an extension chord on a display-only chord loses to it and never matches", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			extensions: [extension("notes", { "notes.close": [{ code: "KeyW", key: "w", mod: true }] })],
		});
		expect(resolved.conflicts).toEqual([
			{ loser: "notes.close", chord: "Mod+KeyW", winner: "tab.close" },
		]);
		expect(matchKeybinding(resolved, ctrl("KeyW"))).toBeNull();
	});

	test("an extension chord outside the grammar is dropped, and a later duplicate id is ignored", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			extensions: [
				extension("notes", {
					"notes.open": [
						{ code: "ShiftLeft", key: "Shift" },
						{ code: "KeyO", key: "o", alt: true },
					],
				}),
				extension("copy", { "notes.open": [MOD_K], "search.open": [MOD_K] }),
			],
		});
		expect(resolved.byId.get("notes.open")?.chords.map((chord) => chord.text)).toEqual([
			"Alt+KeyO",
		]);
		expect(keybindingLabel(resolved, "notes.open")).toBe("Alt+O");
		expect(resolved.commands.filter((command) => command.id === "search.open")).toHaveLength(1);
		expect(resolved.conflicts).toEqual([]);
	});
});
