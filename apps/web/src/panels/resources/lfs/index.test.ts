import { expect, test } from "bun:test";
import { lfsRenderer } from ".";
import { formatLfsSize, parseLfsPointer } from "./lfsPointer";

const POINTER =
	"version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 12345\n";

test("an LFS pointer parses to its object id and size, and nothing else does", () => {
	expect(parseLfsPointer(POINTER)).toEqual({
		oid: "4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393",
		size: 12345,
	});
	expect(parseLfsPointer("version https://git-lfs.github.com/spec/v1\nsize 1\n")).toBeNull();
	expect(parseLfsPointer(`${POINTER}comment extra\n`)).toBeNull();
	expect(parseLfsPointer("not a pointer")).toBeNull();
});

test("LFS sizes read like a file manager", () => {
	expect(formatLfsSize(512)).toBe("512 B");
	expect(formatLfsSize(12345)).toBe("12 KB");
	expect(formatLfsSize(1_572_864)).toBe("1.5 MB");
	expect(formatLfsSize(5 * 1024 ** 3)).toBe("5.0 GB");
});

test("the LFS renderer claims only pointer text, places no anchors, and outranks the code renderer", () => {
	expect(lfsRenderer.match).toEqual({ mime: ["application/vnd.git-lfs"], text: true });
	expect(lfsRenderer.rank).toBeGreaterThan(100);
	expect(lfsRenderer.capabilities.anchors).toEqual({ view: [], diff: [] });
});
