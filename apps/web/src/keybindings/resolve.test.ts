import { describe, expect, test } from "bun:test";
import {
	actsIn,
	type ExtensionCommandSet,
	formatChord,
	globalHolder,
	KEYBINDINGS,
	keybindingLabel,
	keybindingShortcut,
	localUses,
	matchKeybinding,
	matchLocal,
	resolveKeybindings,
	SHORTCUT_CATALOG,
} from ".";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";
const WINDOWS = "Win32";
const PLATFORMS = [MAC, LINUX, WINDOWS, ""];

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

const mod = (platform: string, code: string, modifiers: Modifiers = {}) =>
	press(code, { ...(platform === MAC ? { metaKey: true } : { ctrlKey: true }), ...modifiers });

function extension(
	name: string,
	chords: Record<string, { code: string; key: string; mod?: true; alt?: true; shift?: true }[]>,
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
			const global = resolved.commands.filter((command) => command.scope === null);
			expect(global.map((command) => command.id)).toEqual(Object.keys(KEYBINDINGS));
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
			{ loser: "search.open", chord: "Mod+KeyK", winner: "view.toggleLeft", scope: null },
		]);
		expect(resolved.byId.get("search.open")?.chords).toEqual([
			expect.objectContaining({ text: "Mod+KeyK", lostTo: "view.toggleLeft" }),
		]);
		expect(keybindingShortcut(resolved, "search.open")).toBeUndefined();
	});

	test("an override on the typed ?'s US position Mod+Shift+/ takes the chord from the cheatsheet", () => {
		for (const platform of [MAC, LINUX]) {
			const resolved = resolveKeybindings({
				platform,
				overrides: { "view.toggleLeft": ["Mod+Shift+Slash"] },
			});
			const slash = { ...mod(platform, "Slash", { shiftKey: true }), key: "?" };
			expect(matchKeybinding(resolved, slash)).toBe("view.toggleLeft");
			expect(matchKeybinding(resolved, { ...slash, code: "Digit7" })).toBeNull();
			expect(resolved.conflicts).toEqual([
				{ loser: "shortcuts.open", chord: "Mod+?", winner: "view.toggleLeft", scope: null },
			]);
			expect(resolved.byId.get("shortcuts.open")?.chords).toEqual([
				expect.objectContaining({ text: "Mod+?", lostTo: "view.toggleLeft" }),
			]);
			expect(keybindingShortcut(resolved, "shortcuts.open")).toBeUndefined();
		}
	});

	test("the typed ? holds Mod+Shift+/ against a lower-ranked extension default", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			extensions: [
				extension("notes", { "notes.open": [{ code: "Slash", key: "/", mod: true, shift: true }] }),
			],
		});
		expect(resolved.conflicts).toEqual([
			{ loser: "notes.open", chord: "Mod+Shift+Slash", winner: "shortcuts.open", scope: null },
		]);
		expect(matchKeybinding(resolved, { ...ctrl("Digit7", { shiftKey: true }), key: "?" })).toBe(
			"shortcuts.open",
		);
	});
});

describe("reserved chords", () => {
	test("an override onto Close tab's display-only Mod+W never matches; Close tab keeps showing it", () => {
		for (const [platform, label] of [
			[MAC, "⌘W"],
			[LINUX, "Ctrl+W"],
			[WINDOWS, "Ctrl+W"],
		] as const) {
			const resolved = resolveKeybindings({
				platform,
				overrides: { "search.open": ["Mod+KeyW"] },
			});
			expect(matchKeybinding(resolved, mod(platform, "KeyW"))).toBeNull();
			expect(resolved.conflicts).toEqual([
				{ loser: "search.open", chord: "Mod+KeyW", winner: "tab.close", scope: null },
			]);
			expect(keybindingShortcut(resolved, "search.open")).toBeUndefined();
			expect(keybindingLabel(resolved, "tab.close")).toBe(label);
			expect(resolved.byId.get("tab.close")?.chords.map(({ lostTo }) => lostTo)).toEqual([
				null,
				null,
			]);
		}
	});

	test("Close tab's own hand-written Mod+W is shown and never matched, like its default", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "tab.close": ["Mod+KeyW"] },
		});
		expect(matchKeybinding(resolved, ctrl("KeyW"))).toBeNull();
		expect(keybindingLabel(resolved, "tab.close")).toBe("Ctrl+W");
		expect(resolved.conflicts).toEqual([]);
	});

	const owned = [
		["Mod+KeyQ", "KeyQ", {}, "desktop.quit"],
		["Mod+Comma", "Comma", {}, "desktop.settings"],
		["Mod+F4", "F4", {}, "desktop.closeItem"],
		["Mod+KeyH", "KeyH", {}, "desktop.hide"],
		["Mod+Alt+KeyH", "KeyH", { altKey: true }, "desktop.hideOthers"],
		["Mod+KeyM", "KeyM", {}, "desktop.minimize"],
		["Mod+Equal", "Equal", {}, "desktop.zoomIn"],
		["Mod+Shift+Equal", "Equal", { shiftKey: true }, "desktop.zoomIn"],
		["Mod+NumpadAdd", "NumpadAdd", {}, "desktop.zoomIn"],
		["Mod+Minus", "Minus", {}, "desktop.zoomOut"],
		["Mod+NumpadSubtract", "NumpadSubtract", {}, "desktop.zoomOut"],
		["Mod+Numpad0", "Numpad0", {}, "desktop.zoomReset"],
		["Mod+Shift+Space", "Space", { shiftKey: true }, "dictation"],
	] as const;

	test("an override onto a chord the desktop or dictation owns, on either OS, loses to its catalog row", () => {
		for (const platform of [MAC, LINUX, WINDOWS]) {
			for (const [chord, code, modifiers, owner] of owned) {
				const resolved = resolveKeybindings({ platform, overrides: { "search.open": [chord] } });
				expect([
					platform,
					chord,
					matchKeybinding(resolved, mod(platform, code, modifiers)),
				]).toEqual([platform, chord, null]);
				expect(resolved.conflicts).toEqual([
					{ loser: "search.open", chord, winner: owner, scope: null },
				]);
				expect(SHORTCUT_CATALOG.some(({ id }) => id === owner)).toBe(true);
			}
		}
	});

	test("an extension default loses a reserved chord only on the OS that owns it", () => {
		const hide = extension("notes", { "notes.hide": [{ code: "KeyH", key: "h", mod: true }] });
		const quit = extension("notes", { "notes.quit": [{ code: "KeyQ", key: "q", mod: true }] });
		const mac = resolveKeybindings({ platform: MAC, extensions: [hide] });
		expect(mac.conflicts).toEqual([
			{ loser: "notes.hide", chord: "Mod+KeyH", winner: "desktop.hide", scope: null },
		]);
		expect(matchKeybinding(mac, press("KeyH", { metaKey: true }))).toBeNull();
		const linux = resolveKeybindings({ platform: LINUX, extensions: [hide, quit] });
		expect(matchKeybinding(linux, ctrl("KeyH"))).toBe("notes.hide");
		expect(matchKeybinding(linux, ctrl("KeyQ"))).toBeNull();
		expect(linux.conflicts).toEqual([
			{ loser: "notes.quit", chord: "Mod+KeyQ", winner: "desktop.quit", scope: null },
		]);
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
			{ loser: "notes.open", chord: "Mod+KeyK", winner: "search.open", scope: null },
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
			{ loser: "timer.start", chord: "Mod+Semicolon", winner: "hint-mode.show", scope: null },
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
			{ loser: "view.toggleLeft", chord: "Mod+KeyB", winner: "notes.open", scope: null },
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
			{ loser: "notes.open", chord: "Mod+KeyU", winner: "search.open", scope: null },
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
			{ loser: "notes.close", chord: "Mod+KeyW", winner: "tab.close", scope: null },
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

describe("local commands", () => {
	const card = (
		enabled = true,
		commands: ExtensionCommandSet["commands"] = CARD_COMMANDS,
	): ExtensionCommandSet => ({
		extension: "ask-user-question",
		enabled,
		commands,
	});
	const CARD_COMMANDS = [
		{
			id: "ask-user-question.discuss",
			title: "hintMode.shortcuts.show",
			scope: "ask-user-question.card",
			chords: [{ code: "KeyD", key: "d" }],
		},
		{
			id: "ask-user-question.skip",
			title: "hintMode.shortcuts.show",
			scope: "ask-user-question.card",
			chords: [{ code: "Escape", key: "Escape", shift: true }],
		},
	] as const;
	const local = (resolved: ReturnType<typeof resolveKeybindings>, scope: string) =>
		(resolved.local.get(scope) ?? []).map(({ id, chord }) => `${id}=${formatChord(chord)}`);

	test("no default conflicts in any element, and no global default equals a local one", () => {
		for (const platform of PLATFORMS) {
			const resolved = resolveKeybindings({ platform, extensions: [card()] });
			expect([platform, resolved.conflicts]).toEqual([platform, []]);
			const globals = new Set(
				resolved.active.map(({ chord }) => (chord.typed ? "" : formatChord(chord))),
			);
			for (const [scope, active] of resolved.local) {
				for (const { id, chord } of active) {
					expect([platform, scope, id, globals.has(formatChord(chord))]).toEqual([
						platform,
						scope,
						id,
						false,
					]);
				}
			}
		}
	});

	test("an element includes the shared arrow twins after its own commands; the shared scope is no element", () => {
		const resolved = resolveKeybindings({ platform: LINUX });
		expect(local(resolved, "trees")).toEqual([
			"trees.search=KeyS",
			"trees.openKept=Mod+Enter",
			"trees.rename=F2",
			"trees.delete=Delete",
			"trees.reorderUp=Alt+Shift+ArrowUp",
			"trees.reorderDown=Alt+Shift+ArrowDown",
			"arrows.left=KeyH",
			"arrows.down=KeyJ",
			"arrows.up=KeyK",
			"arrows.right=KeyL",
		]);
		expect(local(resolved, "review")).not.toContain("arrows.down=KeyJ");
		expect(resolved.local.has("arrows")).toBe(false);
		expect(actsIn(resolved, "arrows")).toEqual([
			"tabs",
			"rails",
			"trees",
			"review.surface",
			"transcript",
		]);
		expect(resolved.byId.get("trees.search")?.scope).toBe("trees");
		expect(resolved.byId.get("trees.search")?.plain).toBe(true);
	});

	test("a local key taken over by an override loses only inside that element", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "trees.search": ["KeyJ"] },
		});
		const twin = resolved.byId.get("arrows.down")?.chords[0];
		expect([twin?.lostTo, twin?.lostIn]).toEqual([
			null,
			[{ scope: "trees", winner: "trees.search" }],
		]);
		expect(local(resolved, "trees")).toContain("trees.search=KeyJ");
		expect(local(resolved, "trees")).not.toContain("arrows.down=KeyJ");
		expect(local(resolved, "transcript")).toContain("arrows.down=KeyJ");
		expect(resolved.conflicts).toEqual([
			{ loser: "arrows.down", chord: "KeyJ", winner: "trees.search", scope: "trees" },
		]);
		const both = resolveKeybindings({
			platform: LINUX,
			overrides: { "trees.search": ["KeyU"], "arrows.down": ["KeyU"] },
		});
		expect(both.byId.get("arrows.down")?.chords[0]?.lostIn).toEqual([
			{ scope: "trees", winner: "trees.search" },
		]);
	});

	test("a twin rebound onto an element's own key wins there as an override, and the own command loses", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "arrows.up": ["KeyS"] },
		});
		expect(resolved.byId.get("trees.search")?.chords[0]?.lostTo).toBe("arrows.up");
		expect(local(resolved, "trees")).toContain("arrows.up=KeyS");
	});

	test("a navigation primitive is refused as an override unless it is the command's own default", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: {
				"trees.search": ["ArrowDown", "Shift+Tab", "KeyG"],
				"ask-user-question.skip": ["Shift+Escape", "Alt+KeyS"],
				"ask-user-question.discuss": ["Shift+Escape"],
			},
			extensions: [card()],
		});
		expect(resolved.byId.get("trees.search")?.chords.map(({ text }) => text)).toEqual(["KeyG"]);
		expect(resolved.byId.get("ask-user-question.skip")?.chords.map(({ text }) => text)).toEqual([
			"Shift+Escape",
			"Alt+KeyS",
		]);
		expect(resolved.byId.get("ask-user-question.discuss")?.chords).toEqual([]);
	});

	test("desktop and dictation reservations take a local chord too", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "trees.search": ["Mod+Shift+Space"] },
		});
		expect(resolved.byId.get("trees.search")?.chords[0]?.lostTo).toBe("dictation");
		expect(local(resolved, "trees")).not.toContain("trees.search=Mod+Shift+Space");
	});

	test("matches by physical key in the focused scopes, innermost first, and not typing in text entry", () => {
		const resolved = resolveKeybindings({ platform: LINUX, extensions: [card()] });
		const russianS = press("KeyS", {}, "ы");
		expect(matchLocal(resolved, ["trees"], russianS)).toBe("trees.search");
		expect(matchLocal(resolved, ["transcript"], russianS)).toBeNull();
		expect(matchLocal(resolved, ["trees"], press("KeyO", {}, "s"))).toBeNull();
		expect(matchLocal(resolved, ["trees"], russianS, { textEntry: true })).toBeNull();
		expect(
			matchLocal(resolved, ["ask-user-question.card"], press("Escape", { shiftKey: true }), {
				textEntry: true,
			}),
		).toBe("ask-user-question.skip");
		expect(matchLocal(resolved, ["review", "trees"], press("KeyJ"))).toBe("review.nextUnreviewed");
		expect(matchLocal(resolved, ["trees", "review"], press("KeyJ"))).toBe("arrows.down");
	});

	test("an extension's local commands need its name as a prefix of both id and scope", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			extensions: [
				card(true, [
					...CARD_COMMANDS,
					{
						id: "trees.hijack",
						title: "hintMode.shortcuts.show",
						scope: "ask-user-question.card",
						chords: [{ code: "KeyX", key: "x" }],
					},
					{
						id: "ask-user-question.intrude",
						title: "hintMode.shortcuts.show",
						scope: "trees",
						chords: [{ code: "KeyX", key: "x" }],
					},
				]),
				extension("notes", { "search.open": [{ code: "KeyU", key: "u", mod: true }] }),
			],
		});
		expect(resolved.byId.has("trees.hijack")).toBe(false);
		expect(resolved.byId.has("ask-user-question.intrude")).toBe(false);
		expect(resolved.byId.get("search.open")?.extension).toBeNull();
		expect(local(resolved, "ask-user-question.card")).toEqual([
			"ask-user-question.discuss=KeyD",
			"ask-user-question.skip=Shift+Escape",
		]);
	});

	test("a switched-off extension's local commands are listed but neither match nor conflict", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			overrides: { "ask-user-question.discuss": ["KeyS"] },
			extensions: [card(false)],
		});
		expect(resolved.byId.get("ask-user-question.discuss")?.enabled).toBe(false);
		expect(local(resolved, "ask-user-question.card")).toEqual([]);
		expect(resolved.conflicts).toEqual([]);
	});

	test("local uses and the global holder of a chord drive the editor's warnings", () => {
		const resolved = resolveKeybindings({
			platform: LINUX,
			extensions: [card(), extension("hint-mode", { "hint-mode.show": [PLAIN_F] })],
		});
		expect(localUses(resolved, "KeyJ")).toEqual([
			{ scope: "tabs", command: "arrows.down" },
			{ scope: "rails", command: "arrows.down" },
			{ scope: "trees", command: "arrows.down" },
			{ scope: "review", command: "review.nextUnreviewed" },
			{ scope: "review.surface", command: "arrows.down" },
			{ scope: "transcript", command: "arrows.down" },
		]);
		expect(globalHolder(resolved, "KeyF")).toBe("hint-mode.show");
		expect(globalHolder(resolved, "Ctrl+KeyK")).toBe("search.open");
		expect(globalHolder(resolved, "KeyS")).toBeNull();
	});
});
