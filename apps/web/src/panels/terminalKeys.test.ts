import { describe, expect, test } from "bun:test";
import { type TerminalKeyEvent, terminalKeyAction, terminalKeyDecision } from "./terminalKeys";

function key(init: Partial<TerminalKeyEvent>): TerminalKeyEvent {
	return {
		type: "keydown",
		code: "",
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		...init,
	};
}

const ctrlShiftC = key({ code: "KeyC", ctrlKey: true, shiftKey: true });

describe("Ctrl+Shift+C", () => {
	test("copies the selection on Linux and Windows", () => {
		for (const platform of ["linux", "windows", "other"] as const) {
			expect(terminalKeyAction(ctrlShiftC, platform, true)).toBe("copy");
		}
	});

	test("is swallowed without a selection so it never sends ^C", () => {
		expect(terminalKeyAction(ctrlShiftC, "linux", false)).toBe("swallow");
	});

	test("is left to the terminal on Apple platforms", () => {
		expect(terminalKeyAction(ctrlShiftC, "apple", true)).toBeNull();
	});

	test("ignores plain Ctrl+C and chords with extra modifiers", () => {
		expect(terminalKeyAction(key({ code: "KeyC", ctrlKey: true }), "linux", true)).toBeNull();
		expect(terminalKeyAction({ ...ctrlShiftC, altKey: true }, "linux", true)).toBeNull();
		expect(terminalKeyAction({ ...ctrlShiftC, metaKey: true }, "linux", true)).toBeNull();
	});

	test("acts on keydown only", () => {
		expect(terminalKeyAction({ ...ctrlShiftC, type: "keypress" }, "linux", true)).toBeNull();
		expect(terminalKeyAction({ ...ctrlShiftC, type: "keyup" }, "linux", true)).toBeNull();
	});
});

describe("the key handler decision", () => {
	function withKeyCode(init: Partial<TerminalKeyEvent>, keyCode: number, isComposing = false) {
		return { ...key(init), keyCode, isComposing };
	}

	test("copies before the keyCode-229 rescue could turn Ctrl+Shift+C into ^C", () => {
		const chord = withKeyCode({ code: "KeyC", ctrlKey: true, shiftKey: true }, 229);
		expect(terminalKeyDecision(chord, "linux", true)).toBe("copy");
		expect(terminalKeyDecision(chord, "windows", false)).toBe("swallow");
	});

	test("leaves plain Ctrl+C to xterm so it still sends ^C", () => {
		expect(
			terminalKeyDecision(withKeyCode({ code: "KeyC", ctrlKey: true }, 67), "linux", true),
		).toBe(null);
	});

	test("still rescues IME control chords", () => {
		expect(
			terminalKeyDecision(withKeyCode({ code: "KeyC", ctrlKey: true }, 229), "linux", true),
		).toEqual({ write: "\x03" });
		expect(terminalKeyDecision(withKeyCode({ code: "Escape" }, 229), "apple", false)).toEqual({
			write: "\x1b",
		});
		expect(terminalKeyDecision(withKeyCode({ code: "KeyA" }, 229), "linux", false)).toBeNull();
		expect(
			terminalKeyDecision(
				withKeyCode({ code: "KeyC", ctrlKey: true, type: "keyup" }, 229),
				"linux",
				false,
			),
		).toBeNull();
	});

	test("leaves everything to the IME while it composes", () => {
		expect(
			terminalKeyDecision(
				withKeyCode({ code: "KeyC", ctrlKey: true, shiftKey: true }, 229, true),
				"linux",
				true,
			),
		).toBeNull();
		expect(
			terminalKeyDecision(withKeyCode({ code: "KeyC", ctrlKey: true }, 229, true), "linux", false),
		).toBeNull();
	});

	test("passes ordinary keys through", () => {
		expect(terminalKeyDecision(withKeyCode({ code: "KeyA" }, 65), "linux", false)).toBeNull();
	});
});
