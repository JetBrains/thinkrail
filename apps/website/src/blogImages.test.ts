import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageContentType, postImageFiles } from "./blogImages";

describe("imageContentType", () => {
	test("maps image extensions case-insensitively", () => {
		expect(imageContentType("shot.png")).toBe("image/png");
		expect(imageContentType("/posts/a/images/PHOTO.JPG")).toBe("image/jpeg");
		expect(imageContentType("diagram.svg")).toBe("image/svg+xml");
	});

	test("rejects files that are not images", () => {
		expect(imageContentType("notes.md")).toBeUndefined();
		expect(imageContentType("README")).toBeUndefined();
	});
});

describe("postImageFiles", () => {
	let directory: string;

	afterEach(() => rmSync(directory, { recursive: true, force: true }));

	test("lists only image files", () => {
		directory = mkdtempSync(join(tmpdir(), "blog-images-"));
		for (const file of ["a.png", "b.WEBP", "notes.txt"]) writeFileSync(join(directory, file), "");
		mkdirSync(join(directory, "nested"));
		expect(postImageFiles(directory).sort()).toEqual(["a.png", "b.WEBP"]);
	});

	test("treats a post without an images folder as having no images", () => {
		directory = mkdtempSync(join(tmpdir(), "blog-images-"));
		expect(postImageFiles(join(directory, "images"))).toEqual([]);
	});

	test("fails on an images path that cannot be read as a folder", () => {
		directory = mkdtempSync(join(tmpdir(), "blog-images-"));
		writeFileSync(join(directory, "images"), "");
		expect(() => postImageFiles(join(directory, "images"))).toThrow();
	});
});
