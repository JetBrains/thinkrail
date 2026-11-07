import { describe, expect, test } from "bun:test";
import { TERMINAL_SHIFT_ENTER_PROTOCOL_VERSION } from "@thinkrail/contracts";
import {
	SHIFT_ENTER_SEQUENCE,
	shiftEnterNewlineActive,
	type TerminalKeyEvent,
	terminalKeyAction,
	terminalKeyDecision,
} from "./terminalKeys";

function key(init: Partial<TerminalKeyEvent>): TerminalKeyEvent {
	return {
		type: "keydown",
		key: "",
		code: "",
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		...init,
	};
}

const ctrlShiftC = key({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true });
const shiftEnter = key({ key: "Enter", code: "Enter", shiftKey: true });

describe("Ctrl+Shift+C", () => {
	test("copies the selection on Linux and Windows", () => {
		for (const platform of ["linux", "windows", "other"] as const) {
			expect(terminalKeyAction(ctrlShiftC, platform, true, true)).toBe("copy");
		}
	});

	test("is swallowed without a selection so it never sends ^C", () => {
		expect(terminalKeyAction(ctrlShiftC, "linux", false, true)).toBe("swallow");
	});

	test("is left to the terminal on Apple platforms", () => {
		expect(terminalKeyAction(ctrlShiftC, "apple", true, true)).toBeNull();
	});

	test("ignores plain Ctrl+C and chords with extra modifiers", () => {
		expect(
			terminalKeyAction(key({ key: "c", code: "KeyC", ctrlKey: true }), "linux", true, true),
		).toBeNull();
		expect(terminalKeyAction({ ...ctrlShiftC, altKey: true }, "linux", true, true)).toBeNull();
		expect(terminalKeyAction({ ...ctrlShiftC, metaKey: true }, "linux", true, true)).toBeNull();
	});

	test("is swallowed on keydown only so keyup still reaches xterm", () => {
		expect(terminalKeyAction({ ...ctrlShiftC, type: "keyup" }, "linux", true, true)).toBeNull();
	});
});

describe("Shift+Enter", () => {
	test("inserts a newline on keydown and swallows keypress, on every platform", () => {
		for (const platform of ["linux", "windows", "apple"] as const) {
			expect(terminalKeyAction(shiftEnter, platform, false, true)).toBe("newline");
			expect(terminalKeyAction({ ...shiftEnter, type: "keypress" }, platform, false, true)).toBe(
				"swallow",
			);
		}
	});

	test("does nothing when the setting is off", () => {
		expect(terminalKeyAction(shiftEnter, "linux", false, false)).toBeNull();
		expect(
			terminalKeyAction({ ...shiftEnter, type: "keypress" }, "linux", false, false),
		).toBeNull();
	});

	test("ignores plain Enter and Enter with other modifiers", () => {
		const enter = key({ key: "Enter", code: "Enter" });
		expect(terminalKeyAction(enter, "linux", false, true)).toBeNull();
		expect(terminalKeyAction({ ...shiftEnter, ctrlKey: true }, "linux", false, true)).toBeNull();
		expect(terminalKeyAction({ ...shiftEnter, altKey: true }, "linux", false, true)).toBeNull();
		expect(terminalKeyAction({ ...shiftEnter, metaKey: true }, "linux", false, true)).toBeNull();
	});

	test("sends ESC CR", () => {
		expect(SHIFT_ENTER_SEQUENCE).toBe("\x1b\r");
	});
});

describe("the Shift+Enter setting against the host protocol", () => {
	test("is honoured only from the protocol that stores it", () => {
		const supported = TERMINAL_SHIFT_ENTER_PROTOCOL_VERSION;
		expect(shiftEnterNewlineActive(supported, true)).toBe(true);
		expect(shiftEnterNewlineActive(supported + 1, true)).toBe(true);
		expect(shiftEnterNewlineActive(supported, false)).toBe(false);
	});

	test("is off against an older host or while the protocol is unknown", () => {
		expect(shiftEnterNewlineActive(TERMINAL_SHIFT_ENTER_PROTOCOL_VERSION - 1, true)).toBe(false);
		expect(shiftEnterNewlineActive(null, true)).toBe(false);
	});
});

describe("the key handler decision", () => {
	function imeKey(init: Partial<TerminalKeyEvent>, isComposing = false) {
		return { ...key(init), keyCode: 229, isComposing };
	}

	test("runs the chords before the keyCode-229 rescue when no IME is composing", () => {
		expect(
			terminalKeyDecision(
				imeKey({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }),
				"linux",
				true,
				true,
			),
		).toBe("copy");
		expect(
			terminalKeyDecision(
				imeKey({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }),
				"linux",
				false,
				true,
			),
		).toBe("swallow");
		expect(
			terminalKeyDecision(
				imeKey({ key: "Enter", code: "Enter", shiftKey: true }),
				"linux",
				false,
				true,
			),
		).toBe("newline");
	});

	test("still rescues IME control chords that are not terminal chords", () => {
		expect(
			terminalKeyDecision(imeKey({ key: "c", code: "KeyC", ctrlKey: true }), "linux", false, true),
		).toEqual({ write: "\x03" });
		expect(terminalKeyDecision(imeKey({ code: "Escape" }), "apple", false, true)).toEqual({
			write: "\x1b",
		});
		expect(
			terminalKeyDecision(imeKey({ key: "a", code: "KeyA" }), "linux", false, true),
		).toBeNull();
	});

	test("leaves everything to the IME while it composes", () => {
		expect(
			terminalKeyDecision(
				imeKey({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }, true),
				"linux",
				true,
				true,
			),
		).toBeNull();
		expect(
			terminalKeyDecision(
				{ ...key({ key: "Enter", code: "Enter", shiftKey: true }), keyCode: 13, isComposing: true },
				"linux",
				false,
				true,
			),
		).toBeNull();
	});

	test("passes ordinary keys through", () => {
		expect(
			terminalKeyDecision(
				{ ...key({ key: "a", code: "KeyA" }), keyCode: 65, isComposing: false },
				"linux",
				false,
				true,
			),
		).toBeNull();
	});
});
