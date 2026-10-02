import { describe, expect, it } from "bun:test";
import {
	type ParsedToolResultContent,
	parseToolResultContent,
	resultText,
	toolValueText,
} from "@thinkrail/extension-api/web";

describe("parseToolResultContent", () => {
	it("preserves text and supported image order while ignoring malformed and unsupported blocks", () => {
		const result = {
			content: [
				{ type: "text", text: "before" },
				{ type: "image", data: "cG5n", mimeType: "image/png", extra: "ignored" },
				null,
				undefined,
				"not a block",
				{ type: "text", text: 42 },
				{ type: "image", data: "", mimeType: "image/png" },
				{ type: "image", data: 42, mimeType: "image/png" },
				{ type: "image", data: "bad", mimeType: 42 },
				{ type: "image", data: "PHN2Zz4=", mimeType: "image/svg+xml" },
				{ type: "image", data: "bad", mimeType: "image/PNG" },
				{ type: "image", data: "missing mime" },
				{ type: "image", mimeType: "image/png" },
				{ type: "other", text: "ignored" },
				{ type: "text", text: "after" },
				{ type: "image", data: "anBlZw==", mimeType: "image/jpeg" },
				{ type: "image", data: "Z2lm", mimeType: "image/gif" },
				{ type: "image", data: "d2VicA==", mimeType: "image/webp" },
			],
		};
		const parsed: ParsedToolResultContent = parseToolResultContent(result);

		expect(parsed).toEqual({
			text: "beforeafter",
			images: [
				{ type: "image", data: "cG5n", mimeType: "image/png" },
				{ type: "image", data: "anBlZw==", mimeType: "image/jpeg" },
				{ type: "image", data: "Z2lm", mimeType: "image/gif" },
				{ type: "image", data: "d2VicA==", mimeType: "image/webp" },
			],
		});
		expect(resultText(result)).toBe(parsed.text);
	});

	it("keeps image-only and empty canonical results free of fallback JSON", () => {
		const image = { type: "image", data: "cG5n", mimeType: "image/png" } as const;
		expect(parseToolResultContent({ content: [image] })).toEqual({ text: "", images: [image] });
		expect(parseToolResultContent({ content: [] })).toEqual({ text: "", images: [] });
		expect(parseToolResultContent({ content: [null, { type: "text" }] })).toEqual({
			text: "",
			images: [],
		});
	});

	it("falls back to readable noncanonical values", () => {
		for (const value of [
			null,
			undefined,
			"hello",
			42,
			false,
			[1, 2],
			{ foo: 1 },
			{ content: {} },
		]) {
			expect(parseToolResultContent(value)).toEqual({ text: toolValueText(value), images: [] });
		}
	});
});

describe("toolValueText", () => {
	it("preserves strings, pretty prints values and treats nullish values as empty", () => {
		expect(toolValueText(null)).toBe("");
		expect(toolValueText(undefined)).toBe("");
		expect(toolValueText("hello")).toBe("hello");
		expect(toolValueText({ foo: 1 })).toBe('{\n  "foo": 1\n}');
		expect(toolValueText(false)).toBe("false");
	});

	it("falls back to String when JSON cannot serialize a value", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(toolValueText(circular)).toBe("[object Object]");
		expect(toolValueText(42n)).toBe("42");
	});
});
