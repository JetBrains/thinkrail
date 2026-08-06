import { describe, expect, test } from "bun:test";
import { createTerminalPrebindBuffer } from "./terminalPrebindBuffer";

describe("terminal pre-bind buffer", () => {
	test("bind returns only the adopted PTY's data and early exit", () => {
		const buffer = createTerminalPrebindBuffer();
		buffer.acceptData({ id: "other", data: "secret" });
		buffer.acceptData({ id: "mine", data: "prompt" });
		buffer.acceptExit({ id: "other", exitCode: 0 });
		buffer.acceptExit({ id: "mine", exitCode: 7 });

		expect(buffer.bind("mine")).toEqual({
			frames: [{ id: "mine", data: "prompt" }],
			truncated: false,
			exit: { id: "mine", exitCode: 7 },
		});
	});

	test("keeps a bounded tail and identifies the PTY whose oldest bytes were dropped", () => {
		const buffer = createTerminalPrebindBuffer(5, 10, 10);
		buffer.acceptData({ id: "mine", data: "1234" });
		buffer.acceptData({ id: "mine", data: "5678" });

		expect(buffer.bind("mine")).toEqual({
			frames: [
				{ id: "mine", data: "4" },
				{ id: "mine", data: "5678" },
			],
			truncated: true,
		});
	});

	test("frame and exit count caps keep even zero-length/event floods bounded", () => {
		const buffer = createTerminalPrebindBuffer(100, 2, 2);
		buffer.acceptData({ id: "first", data: "" });
		buffer.acceptData({ id: "mine", data: "a" });
		buffer.acceptData({ id: "mine", data: "b" });
		buffer.acceptExit({ id: "old", exitCode: 1 });
		buffer.acceptExit({ id: "other", exitCode: 2 });
		buffer.acceptExit({ id: "mine", exitCode: 3 });

		expect(buffer.bind("mine")).toEqual({
			frames: [
				{ id: "mine", data: "a" },
				{ id: "mine", data: "b" },
			],
			truncated: false,
			exit: { id: "mine", exitCode: 3 },
		});
	});

	test("many evicted PTY ids collapse to one bounded conservative truncation marker", () => {
		const buffer = createTerminalPrebindBuffer(100, 1, 1);
		buffer.acceptData({ id: "first", data: "a" });
		buffer.acceptData({ id: "second", data: "b" });
		buffer.acceptData({ id: "mine", data: "c" });

		expect(buffer.bind("mine")).toEqual({
			frames: [{ id: "mine", data: "c" }],
			truncated: true,
		});
	});

	test("bind and stop both make the buffer permanently inert", () => {
		const bound = createTerminalPrebindBuffer();
		bound.bind("mine");
		expect(bound.acceptData({ id: "mine", data: "late" })).toBe(false);
		expect(bound.acceptExit({ id: "mine", exitCode: 0 })).toBe(false);

		const failed = createTerminalPrebindBuffer();
		failed.acceptData({ id: "other", data: "held" });
		failed.stop();
		expect(failed.acceptData({ id: "other", data: "later" })).toBe(false);
		expect(failed.bind("other")).toEqual({ frames: [], truncated: false });
	});
});
