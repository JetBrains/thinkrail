import { describe, expect, test } from "bun:test";
import { SHIFT_ENTER_SEQUENCE, type TerminalKeyEvent, terminalKeyAction } from "./terminalKeys";

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
