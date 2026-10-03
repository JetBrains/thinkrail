import { describe, expect, test } from "bun:test";
import { type NativeQuitHint, QUIT_CONFIRMATION } from "@thinkrail/contracts";
import {
	createWebShortcuts,
	hasWebShortcuts,
	matchShortcut,
	SHORTCUT_COMMANDS,
	type ShortcutPlatform,
	shortcutPlatform,
} from "./shortcutCommands";
import { globalHotkeyCommand } from "./useGlobalHotkeys";

const { holdMs, pollMs } = QUIT_CONFIRMATION;
const TERMINAL = { terminal: true };

function chord(code: string, overrides: Partial<KeyboardEvent> = {}) {
	return {
		code,
		key: "",
		ctrlKey: true,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...overrides,
	};
}

function harness(platform: ShortcutPlatform = "linux") {
	let time = 0;
	let poll: (() => void) | null = null;
	const hints: NativeQuitHint[] = [];
	const log: string[] = [];
	const shortcuts = createWebShortcuts({
		platform,
		closeItem: () => log.push("close-item"),
		quit: () => log.push("quit"),
		onQuitHint: (hint) => hints.push(hint),
		isInTerminal: (target) => target === TERMINAL,
		now: () => time,
		every: (callback) => {
			poll = callback;
			return () => {
				poll = null;
			};
		},
	});
	function keydown(code: string, overrides: Partial<KeyboardEvent> = {}, target: unknown = null) {
		const event = {
			...chord(code, overrides),
			repeat: overrides.repeat ?? false,
			target: target as EventTarget | null,
			prevented: false,
			preventDefault() {
				event.prevented = true;
			},
			stopPropagation() {},
		};
		shortcuts.keydown(event);
		return event.prevented;
	}
	function advance(ms: number) {
		const end = time + ms;
		while (time < end) {
			time = Math.min(end, time + pollMs);
			poll?.();
		}
	}
	return {
		shortcuts,
		hints,
		log,
		keydown,
		keyup: (code: string, key = "") => shortcuts.keyup({ code, key }),
		advance,
	};
}

describe("shortcut platform", () => {
	test("binds web chords only on desktop Windows and Linux", () => {
		expect(shortcutPlatform(false, "Linux x86_64")).toBe("browser");
		expect(shortcutPlatform(true, "MacIntel")).toBe("apple");
		expect(shortcutPlatform(true, "Win32")).toBe("windows");
		expect(shortcutPlatform(true, "Linux x86_64")).toBe("linux");
		expect(shortcutPlatform(true, "")).toBe("browser");
	});
});

describe("chord matching", () => {
	test("each platform binds its table and only with a bare Ctrl", () => {
		const table = {
			apple: { KeyW: null, F4: null, KeyQ: null },
			browser: { KeyW: null, F4: null, KeyQ: null },
			windows: { KeyW: "close-item", F4: "close-item", KeyQ: null },
			linux: { KeyW: "close-item", F4: "close-item", KeyQ: "quit" },
		} as const;
		for (const [platform, codes] of Object.entries(table)) {
			for (const [code, command] of Object.entries(codes)) {
				expect(matchShortcut(chord(code), platform as ShortcutPlatform, () => false)).toBe(command);
				expect(
					matchShortcut(
						chord(code, { ctrlKey: false, metaKey: true }),
						platform as ShortcutPlatform,
						() => false,
					),
				).toBeNull();
			}
		}
		for (const modifier of ["metaKey", "altKey", "shiftKey"] as const) {
			expect(matchShortcut(chord("KeyW", { [modifier]: true }), "linux", () => false)).toBeNull();
		}
		expect(matchShortcut(chord("KeyW", { ctrlKey: false }), "linux", () => false)).toBeNull();
		const terminalCheckSkipped = () => {
			throw new Error("terminal check must run only after a chord matches");
		};
		expect(
			matchShortcut(chord("KeyQ", { ctrlKey: false }), "linux", terminalCheckSkipped),
		).toBeNull();
		expect(matchShortcut(chord("KeyA"), "linux", terminalCheckSkipped)).toBeNull();
	});

	test("inside a terminal Ctrl+W goes to the shell; Ctrl+F4 and Ctrl+Q stay app-owned", () => {
		expect(matchShortcut(chord("KeyW"), "linux", () => true)).toBeNull();
		expect(matchShortcut(chord("F4"), "windows", () => true)).toBe("close-item");
		expect(matchShortcut(chord("KeyQ"), "linux", () => true)).toBe("quit");
	});

	test("letter chords follow the typed letter; non-Latin layouts fall back to code", () => {
		const azertyUndo = chord("KeyW", { key: "z" });
		const azertySelectAll = chord("KeyQ", { key: "a" });
		expect(matchShortcut(azertyUndo, "windows", () => false)).toBeNull();
		expect(matchShortcut(azertyUndo, "linux", () => false)).toBeNull();
		expect(matchShortcut(azertySelectAll, "linux", () => false)).toBeNull();
		expect(matchShortcut(azertySelectAll, "linux", () => true)).toBeNull();
		expect(matchShortcut(chord("KeyZ", { key: "w" }), "windows", () => false)).toBe("close-item");
		expect(matchShortcut(chord("KeyA", { key: "q" }), "linux", () => true)).toBe("quit");
		expect(matchShortcut(chord("KeyW", { key: "W" }), "linux", () => false)).toBe("close-item");
		expect(matchShortcut(chord("KeyW", { key: "ц" }), "linux", () => false)).toBe("close-item");
		expect(matchShortcut(chord("F4", { key: "F4" }), "windows", () => false)).toBe("close-item");
	});
});

test("only windows and linux bind web chords", () => {
	expect(hasWebShortcuts("apple")).toBe(false);
	expect(hasWebShortcuts("browser")).toBe(false);
	expect(hasWebShortcuts("windows")).toBe(true);
	expect(hasWebShortcuts("linux")).toBe(true);
});

test("no table chord is also a global hotkey", () => {
	const available = { projects: true, workspace: true, bottom: true, newWorkspace: true };
	for (const platform of ["Win32", "Linux x86_64"]) {
		for (const command of SHORTCUT_COMMANDS) {
			for (const { code } of Object.values(command.chords).flat()) {
				expect(globalHotkeyCommand(chord(code), available, false, platform)).toBeNull();
			}
		}
	}
});

test("keydown swallows repeats and leaves terminal Ctrl+W unprevented", () => {
	const h = harness("linux");
	expect(h.keydown("F4", { repeat: true })).toBe(true);
	expect(h.log).toEqual([]);
	expect(h.keydown("KeyW", {}, TERMINAL)).toBe(false);
	expect(h.keydown("F4", {}, TERMINAL)).toBe(true);
	expect(h.log).toEqual(["close-item"]);
});

describe("linux quit confirmation", () => {
	test("a second press inside the window quits on KeyQ release, once", () => {
		const h = harness();
		h.keydown("KeyQ");
		h.keyup("KeyQ");
		h.advance(120);
		h.keydown("KeyQ");
		expect(h.hints).toEqual(["armed", "release"]);
		h.keydown("KeyQ", { repeat: true });
		h.keyup("KeyQ");
		h.keydown("KeyQ");
		h.keyup("KeyQ");
		expect(h.hints).toEqual(["armed", "release", "quitting"]);
		expect(h.log).toEqual(["quit"]);
	});

	test("a hold ignores unrelated keyups and quits on Control release", () => {
		const h = harness();
		h.keydown("KeyQ");
		h.keyup("KeyA", "a");
		for (let elapsed = 0; elapsed < holdMs + pollMs; elapsed += pollMs) {
			h.keydown("KeyQ", { repeat: true });
			h.advance(pollMs);
		}
		expect(h.hints).toEqual(["armed", "release"]);
		expect(h.log).toEqual([]);
		h.keyup("ControlLeft", "Control");
		expect(h.hints).toEqual(["armed", "release", "quitting"]);
		expect(h.log).toEqual(["quit"]);
	});

	test("an AZERTY hold releases only on the key it started with", () => {
		const h = harness();
		h.keydown("KeyA", { key: "q" });
		h.keyup("KeyQ", "a");
		h.advance(holdMs + pollMs);
		expect(h.hints).toEqual(["armed", "release"]);
		h.keyup("KeyA", "q");
		expect(h.hints).toEqual(["armed", "release", "quitting"]);
		expect(h.log).toEqual(["quit"]);
	});
});
