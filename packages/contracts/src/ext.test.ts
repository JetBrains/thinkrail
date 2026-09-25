import { expect, test } from "bun:test";
import { extToolId, isExtLayoutToolId, parseExtToolId } from "./ext";

test("extension panel tool ids round-trip", () => {
	const id = extToolId({ name: "timeline", surfaceId: "panel" });
	expect(id).toBe("ext:timeline:panel");
	expect(parseExtToolId(id)).toEqual({ name: "timeline", surfaceId: "panel" });
	expect(isExtLayoutToolId(id)).toBe(true);
});

test("malformed extension tool ids are rejected", () => {
	for (const tool of ["files", "ext:", "ext:timeline", "ext:Time:panel", "ext:a:b:c", "ext::b"]) {
		expect(isExtLayoutToolId(tool)).toBe(false);
	}
});
