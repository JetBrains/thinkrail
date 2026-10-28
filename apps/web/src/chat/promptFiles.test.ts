import { afterEach, expect, test } from "bun:test";
import type { NativeClipboardBridge } from "@thinkrail/contracts";
import {
	insertPromptText,
	nativeClipboardBridge,
	prepareClipboardPaste,
	preparePromptFiles,
} from "./promptFiles";

afterEach(() => Reflect.deleteProperty(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__"));

test("discovers an optional clipboard capability without importing the desktop", () => {
	for (const value of [undefined, null, {}, { readFiles: "not callable" }]) {
		Reflect.set(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__", value);
		expect(nativeClipboardBridge()).toBeUndefined();
	}
	const bridge: NativeClipboardBridge = { readFiles: async () => [] };
	Reflect.set(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__", bridge);
	expect(nativeClipboardBridge()).toBe(bridge);
});

test("original paths win over browser file icons and duplicated clipboard text", async () => {
	const result = await prepareClipboardPaste(
		[new File(["icon"], "icon.png", { type: "image/png" })],
		"report.pdf",
		{ readFiles: async () => [{ path: "/tmp/report.pdf" }, { path: "/tmp/项目 文件夹" }] },
	);
	expect(result).toEqual({
		text: "",
		files: [
			{ name: "report.pdf", path: "/tmp/report.pdf" },
			{ name: "项目 文件夹", path: "/tmp/项目 文件夹" },
		],
	});
});

test("unknown browser files do not invent paths and retain accompanying text", async () => {
	const files = [
		new File(["x"], "report.pdf", { type: "application/pdf" }),
		new File([], "folder"),
	];
	const prepared = await preparePromptFiles(files);
	expect(prepared).toEqual([
		{ name: "report.pdf", error: "pathUnavailable" },
		{ name: "folder", error: "pathUnavailable" },
	]);
	expect(await prepareClipboardPaste(files, "keep this", { readFiles: async () => [] })).toEqual({
		files: prepared,
		text: "keep this",
	});
});

test("bad native image data retains its original path for fallback", async () => {
	expect(
		await prepareClipboardPaste([], "", {
			readFiles: async () => [
				{
					path: "C:\\My Photos\\broken.heic",
					image: { mimeType: "image/heic", data: "!not-base64!" },
				},
			],
		}),
	).toEqual({ files: [{ path: "C:\\My Photos\\broken.heic", name: "broken.heic" }], text: "" });
});

test("a native read failure never attaches a browser icon but preserves plain text paste", async () => {
	const bridge: NativeClipboardBridge = {
		readFiles: async () => {
			throw new Error("unavailable");
		},
	};
	expect(await prepareClipboardPaste([], "ordinary text", bridge)).toEqual({
		files: [],
		text: "ordinary text",
	});
	await expect(
		prepareClipboardPaste([new File(["icon"], "icon.png")], "name", bridge),
	).rejects.toThrow("unavailable");
	await expect(prepareClipboardPaste([], "", bridge)).rejects.toThrow("unavailable");
});

test("path text replaces selection, preserves raw paths, and separates adjacent text", () => {
	expect(
		insertPromptText("Review:old please", 7, 10, "", ["/tmp/中文 a.pdf", "/tmp/folder"]),
	).toEqual({ value: "Review: /tmp/中文 a.pdf\n/tmp/folder please", caret: 33 });
	const windows = "C:\\My Files\\report.pdf";
	expect(insertPromptText("", 0, 0, "", [windows])).toEqual({
		value: windows,
		caret: windows.length,
	});
	expect(insertPromptText("AB", 1, 1, "", ["/tmp/a"])).toEqual({ value: "A /tmp/a B", caret: 9 });
});

test("ordinary text insertion is not trimmed, spaced, or interpreted as paths", () => {
	expect(insertPromptText("one old end", 4, 7, "  new\ntext  ", [])).toEqual({
		value: "one   new\ntext   end",
		caret: 16,
	});
	expect(insertPromptText("see ", 4, 4, "", ["/tmp/a "])).toEqual({
		value: "see /tmp/a ",
		caret: 11,
	});
});
