import { describe, expect, test } from "bun:test";
import { createTerminalImeBridge } from "./terminalImeBridge";

const IME = 229;
const ENTER = 13;
const SPACE = 32;
const BACKSPACE = 8;

function harness() {
	const sent: string[] = [];
	const bridge = createTerminalImeBridge((data) => sent.push(data));
	const input = (inputType: string, data: string | null): boolean => {
		let stopped = false;
		bridge.input({
			inputType,
			data,
			stopPropagation: () => {
				stopped = true;
			},
		});
		return stopped;
	};
	const keydown = (
		keyCode: number,
		key: string,
		mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {},
	): boolean => {
		let stopped = false;
		bridge.keydown({
			key,
			keyCode,
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			...mods,
			stopPropagation: () => {
				stopped = true;
			},
		});
		return stopped;
	};
	return { sent, bridge, input, keydown };
}

describe("terminal IME bridge (WebKit replacement model)", () => {
	test("holds a syllable while it is re-composed and writes it when the next one starts", () => {
		const { sent, input, keydown } = harness();
		// WKWebView + macOS 2-Set Korean typing 가나다 (r k s k e k): input precedes keydown.
		expect(input("insertText", "ㄱ")).toBe(true);
		keydown(IME, "ㄱ");
		expect(input("insertReplacementText", "가")).toBe(true);
		keydown(IME, "ㅏ");
		expect(input("insertReplacementText", "간")).toBe(true);
		keydown(IME, "ㄴ");
		expect(input("insertReplacementText", "가")).toBe(true);
		expect(input("insertText", "나")).toBe(true);
		keydown(IME, "ㅏ");
		expect(input("insertReplacementText", "낟")).toBe(true);
		keydown(IME, "ㄷ");
		expect(input("insertReplacementText", "나")).toBe(true);
		expect(input("insertText", "다")).toBe(true);
		keydown(IME, "ㅏ");
		expect(sent).toEqual(["가", "나"]);

		expect(input("insertReplacementText", "다")).toBe(true);
		expect(keydown(ENTER, "Enter")).toBe(false);
		expect(sent).toEqual(["가", "나", "다"]);
	});

	test("Space and other plain keys commit the held syllable ahead of their own byte", () => {
		const { sent, input, keydown } = harness();
		input("insertText", "ㄱ");
		keydown(IME, "ㄱ");
		input("insertReplacementText", "가");
		keydown(IME, "ㅏ");
		input("insertReplacementText", "가");
		expect(keydown(SPACE, " ")).toBe(false);
		expect(sent).toEqual(["가"]);
		expect(input("insertText", " ")).toBe(false);
		expect(sent).toEqual(["가"]);
	});

	test("Backspace re-composes silently; a passed-through Backspace drops the held jamo", () => {
		const { sent, input, keydown } = harness();
		input("insertText", "ㄱ");
		keydown(IME, "ㄱ");
		input("insertReplacementText", "가");
		keydown(IME, "ㅏ");
		input("insertReplacementText", "ㄱ");
		keydown(IME, "Backspace");
		input("insertReplacementText", "ㄱ");
		expect(keydown(BACKSPACE, "Backspace")).toBe(true);
		expect(sent).toEqual([]);
		expect(keydown(BACKSPACE, "Backspace")).toBe(false);
		expect(sent).toEqual([]);
	});

	test("control chords and Escape commit the syllable and reach xterm's own handlers", () => {
		const { sent, input, keydown } = harness();
		input("insertText", "ㄱ");
		keydown(IME, "ㄱ");
		input("insertReplacementText", "가");
		expect(keydown(67, "ㅊ", { ctrlKey: true })).toBe(false);
		expect(sent).toEqual(["가"]);

		input("insertText", "ㄴ");
		expect(keydown(IME, "Escape")).toBe(false);
		expect(keydown(IME, "c", { ctrlKey: true })).toBe(false);
		expect(sent).toEqual(["가"]);
	});

	test("modifier keys do not commit a syllable that is still being composed", () => {
		const { sent, input, keydown } = harness();
		input("insertText", "ㅇ");
		keydown(IME, "ㅇ");
		input("insertReplacementText", "이");
		keydown(IME, "ㅣ");
		expect(keydown(16, "Shift")).toBe(false);
		input("insertReplacementText", "있");
		keydown(IME, "ㅆ");
		expect(sent).toEqual([]);
		input("insertReplacementText", "있");
		keydown(SPACE, " ");
		expect(sent).toEqual(["있"]);
	});

	test("bare sentinel keydowns are withheld only once the replacement model is seen", () => {
		const { input, keydown } = harness();
		expect(keydown(IME, "ㄱ")).toBe(false);
		input("insertText", "ㄱ");
		expect(keydown(IME, "ㄱ")).toBe(true);
		expect(keydown(IME, "Escape")).toBe(false);
		expect(keydown(IME, "c", { metaKey: true })).toBe(false);
	});

	test("everything that is not a single Hangul code point stays on xterm's path", () => {
		const { sent, input, keydown } = harness();
		expect(input("insertText", "a")).toBe(false);
		expect(input("insertText", "안녕하세요")).toBe(false);
		expect(input("insertReplacementText", "the")).toBe(false);
		expect(input("insertFromPaste", "ㄱ")).toBe(false);
		expect(input("insertText", null)).toBe(false);
		expect(keydown(65, "a")).toBe(false);
		expect(sent).toEqual([]);
	});

	test("a composition taking over mid-syllable flushes the held jamo first, keeping order", () => {
		const { sent, bridge, input } = harness();
		input("insertText", "ㄱ");
		bridge.compositionstart();
		expect(sent).toEqual(["ㄱ"]);
		expect(bridge.pending).toBe("");
	});

	test("focus-out and the next non-Hangul insertText flush what is held", () => {
		const { sent, bridge, input } = harness();
		input("insertText", "ㅁ");
		input("insertReplacementText", "마");
		expect(bridge.pending).toBe("마");
		bridge.flush();
		expect(sent).toEqual(["마"]);
		expect(bridge.pending).toBe("");

		input("insertText", "ㄱ");
		expect(input("insertText", "1")).toBe(false);
		expect(sent).toEqual(["마", "ㄱ"]);
	});
});
