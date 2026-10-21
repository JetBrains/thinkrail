import { expect, test } from "bun:test";
import { diffResourceMeta, PENDING_TEXT_META, resourceContent } from "./content";

const text = { hash: "t", byteLength: 4, text: true };
const bytes = { hash: "b", byteLength: 3, text: false };
const absent = { hash: null, byteLength: null, text: true };

test("content follows the metadata: provisional text, absent, text, bytes, or absent without a URL", () => {
	expect(resourceContent("draft", undefined, () => null)).toEqual({
		kind: "text",
		text: "draft",
		hash: "",
	});
	expect(resourceContent("", absent, () => "/files/x")).toEqual({ kind: "absent" });
	expect(resourceContent("body", text, () => "/files/x")).toEqual({
		kind: "text",
		text: "body",
		hash: "t",
	});
	expect(resourceContent("", bytes, () => "/files/x")).toEqual({
		kind: "bytes",
		url: "/files/x",
		hash: "b",
		byteLength: 3,
	});
	expect(resourceContent("", bytes, () => null)).toEqual({ kind: "absent" });
});

test("a diff is described by its modified side unless that side is absent, and is text only if both are", () => {
	expect(diffResourceMeta(text, bytes)).toEqual({ ...bytes, text: false });
	expect(diffResourceMeta(bytes, absent)).toEqual({ ...bytes, text: false });
	expect(diffResourceMeta(absent, text)).toEqual(text);
	expect(diffResourceMeta(absent, absent)).toEqual(PENDING_TEXT_META);
});
