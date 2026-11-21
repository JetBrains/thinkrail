import { describe, expect, test } from "bun:test";
import { composerShiftTabOut, composerTranscriptStep } from "./composerKeys";

describe("composer keys", () => {
	test("enters from one line, else first brings the caret to the start", () => {
		expect(composerTranscriptStep(false, false)).toBe("enter");
		expect(composerTranscriptStep(false, true)).toBe("enter");
		expect(composerTranscriptStep(true, false)).toBe("caretToStart");
		expect(composerTranscriptStep(true, true)).toBe("enter");
	});

	test("a plain Shift+Tab leaves the composer backward unless a menu or template slots hold it", () => {
		const press = (
			modifiers: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>>,
		) => ({
			key: "Tab",
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			...modifiers,
		});
		expect(composerShiftTabOut(press({ shiftKey: true }), false)).toBe(true);
		expect(composerShiftTabOut(press({ shiftKey: true }), true)).toBe(false);
		expect(composerShiftTabOut(press({}), false)).toBe(false);
		expect(composerShiftTabOut(press({ shiftKey: true, ctrlKey: true }), false)).toBe(false);
		expect(composerShiftTabOut({ ...press({ shiftKey: true }), key: "Enter" }, false)).toBe(false);
	});
});
