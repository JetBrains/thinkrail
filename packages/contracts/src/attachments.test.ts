import { expect, test } from "bun:test";
import {
	attachmentImageType,
	copiedFilePaths,
	isChatAttachmentResult,
	withAttachedFiles,
} from "./attachments";

test("raster images by type or extension go to the model, HEIC, TIFF and AVIF included", () => {
	expect(attachmentImageType({ name: "shot.png", type: "image/png" })).toBe("image/png");
	expect(attachmentImageType({ name: "photo.heic", type: "" })).toBe("image/heic");
	expect(attachmentImageType({ name: "PHOTO.JPG", type: "" })).toBe("image/jpeg");
	expect(attachmentImageType({ name: "scan", type: "image/bmp" })).toBe("image/bmp");
	expect(attachmentImageType({ name: "scan.TIF", type: "" })).toBe("image/tiff");
	expect(attachmentImageType({ name: "frame.avif", type: "" })).toBe("image/avif");
	expect(attachmentImageType({ name: "live.heif", type: "" })).toBe("image/heif");
});

test("everything else, SVG included, is a file", () => {
	expect(attachmentImageType({ name: "design.pdf", type: "application/pdf" })).toBeNull();
	expect(attachmentImageType({ name: "logo.svg", type: "image/svg+xml" })).toBeNull();
	expect(attachmentImageType({ name: "logo.svg", type: "" })).toBeNull();
	expect(attachmentImageType({ name: "demo.mp4", type: "video/mp4" })).toBeNull();
	expect(attachmentImageType({ name: ".png", type: "" })).toBeNull();
	expect(attachmentImageType({ name: "notes", type: "" })).toBeNull();
	expect(attachmentImageType({ name: "a.constructor", type: "" })).toBeNull();
});

test("withAttachedFiles lists non-image attachments after the prompt", () => {
	expect(withAttachedFiles("Do it", [])).toBe("Do it");
	expect(withAttachedFiles("Do it", ["/a/b.md", "/c.txt"])).toBe(
		"Do it\n\nAttached files:\n- /a/b.md\n- /c.txt",
	);
	expect(withAttachedFiles("", [".thinkrail/context/attachments/a.pdf"])).toBe(
		"Attached files:\n- .thinkrail/context/attachments/a.pdf",
	);
});

test("isChatAttachmentResult accepts the two closed shapes only", () => {
	expect(isChatAttachmentResult({ ok: true, path: "a.pdf" })).toBe(true);
	expect(isChatAttachmentResult({ ok: false, error: "too-large" })).toBe(true);
	expect(isChatAttachmentResult({ ok: false, error: "nope" })).toBe(false);
	expect(isChatAttachmentResult({ ok: true })).toBe(false);
	expect(isChatAttachmentResult(null)).toBe(false);
});

test("copiedFilePaths reads a file:// URI list as absolute paths", () => {
	expect(copiedFilePaths("file:///home/me/My%20Design.pdf")).toEqual(["/home/me/My Design.pdf"]);
	expect(copiedFilePaths("file:///home/me/a.pdf\r\nfile:///home/me/b.txt\r\n")).toEqual([
		"/home/me/a.pdf",
		"/home/me/b.txt",
	]);
	expect(copiedFilePaths("file://localhost/tmp/a.txt\r\n")).toEqual(["/tmp/a.txt"]);
});

test("copiedFilePaths reads GNOME's copied-files text, with or without Nautilus's header", () => {
	expect(copiedFilePaths("copy\nfile:///home/me/a.png")).toEqual(["/home/me/a.png"]);
	expect(copiedFilePaths("cut\nfile:///home/me/a.png\nfile:///home/me/b%23.md\n")).toEqual([
		"/home/me/a.png",
		"/home/me/b#.md",
	]);
	expect(copiedFilePaths("x-special/nautilus-clipboard\ncopy\nfile:///home/me/a.png\n")).toEqual([
		"/home/me/a.png",
	]);
	expect(copiedFilePaths("x-special/nautilus-clipboard\r\ncut\r\nfile:///tmp/a.pdf\r\n")).toEqual([
		"/tmp/a.pdf",
	]);
});

test("copiedFilePaths leaves bare absolute paths to the text unless the clipboard offers a file target", () => {
	expect(copiedFilePaths("/home/me/design.pdf\n/home/me/notes.txt\n")).toBeNull();
	expect(copiedFilePaths("/etc/hosts")).toBeNull();
	expect(copiedFilePaths("copy\n/home/me/design.pdf")).toBeNull();
	expect(copiedFilePaths("file:///home/me/a.pdf\n/home/me/b.pdf")).toBeNull();
	expect(copiedFilePaths("/home/me/design.pdf\n/home/me/notes.txt\n", { barePaths: true })).toEqual(
		["/home/me/design.pdf", "/home/me/notes.txt"],
	);
	expect(copiedFilePaths("file:///home/me/a.pdf\n/home/me/b.pdf", { barePaths: true })).toEqual([
		"/home/me/a.pdf",
		"/home/me/b.pdf",
	]);
});

test("copiedFilePaths refuses ordinary text, remote URIs and relative paths", () => {
	expect(copiedFilePaths("")).toBeNull();
	expect(copiedFilePaths("hello world")).toBeNull();
	expect(copiedFilePaths("copy")).toBeNull();
	expect(copiedFilePaths("x-special/nautilus-clipboard\ncopy\n")).toBeNull();
	expect(copiedFilePaths("copy\nfile:///home/me/a.pdf\nand some prose")).toBeNull();
	expect(copiedFilePaths("/home/me/a.pdf\nand some prose", { barePaths: true })).toBeNull();
	expect(copiedFilePaths("file://server/share/a.pdf")).toBeNull();
	expect(copiedFilePaths("https://example.com/a.pdf")).toBeNull();
	expect(copiedFilePaths("docs/a.pdf", { barePaths: true })).toBeNull();
	expect(copiedFilePaths("file:///bad%zz")).toBeNull();
});
