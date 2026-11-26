import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeClipboardContent } from "@thinkrail/contracts";
import { createClipboardBridge, needsNativeClipboard } from "./clipboardBridge";
import {
	CLIPBOARD_LIMITS,
	type ClipboardLimits,
	type ClipboardReader,
	type HelperProcess,
	readNativeClipboard,
} from "./nativeClipboard";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "trpi-clipboard-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const X11 = { DISPLAY: ":0" };
const FAST: ClipboardLimits = { ...CLIPBOARD_LIMITS, listTimeoutMs: 30, textTimeoutMs: 30 };

function electrobun(
	formats: string[],
	text: string | null,
	image: Uint8Array | null = null,
): { read: ClipboardReader; calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		read: {
			availableFormats: () => {
				calls.push("formats");
				return formats;
			},
			readText: () => {
				calls.push("text");
				return text;
			},
			readImage: () => {
				calls.push("image");
				return image;
			},
		},
	};
}

type Answer = string | Uint8Array<ArrayBuffer> | { code: number } | "missing" | "hang";

function helpers(answer: (command: string[]) => Answer) {
	const commands: string[] = [];
	const killed: string[] = [];
	const spawn = (command: string[]): HelperProcess => {
		const name = command.join(" ");
		commands.push(name);
		const reply = answer(command);
		if (reply === "missing") throw new Error("ENOENT");
		if (reply === "hang") {
			const exit = Promise.withResolvers<number>();
			const stdout = new TransformStream<Uint8Array, Uint8Array>();
			return {
				stdout: stdout.readable,
				exited: exit.promise,
				kill: () => {
					killed.push(name);
					stdout.writable.close().catch(() => undefined);
					exit.resolve(137);
				},
			};
		}
		const failed = typeof reply === "object" && "code" in reply;
		return {
			stdout: new Response(failed ? "" : reply).body ?? new ReadableStream(),
			exited: Promise.resolve(failed ? reply.code : 0),
			kill: () => {
				killed.push(name);
			},
		};
	};
	return { spawn, commands, killed };
}

const TARGETS = "xclip -o -selection clipboard -t TARGETS";
const xclipRead = (target: string) => `xclip -o -selection clipboard -t ${target}`;

test("only the Linux webview needs the native clipboard", () => {
	expect(needsNativeClipboard("Linux x86_64")).toBe(true);
	expect(needsNativeClipboard("MacIntel")).toBe(false);
	expect(needsNativeClipboard("Win32")).toBe(false);
});

test("a pcmanfm copy is listed by xclip, never through Electrobun's blocking calls", async () => {
	const pdf = join(dir, "My Notes.pdf");
	writeFileSync(pdf, "%PDF");
	mkdirSync(join(dir, "folder"));
	const native = electrobun(["files"], null);
	const helper = helpers((command) =>
		command.at(-1) === "TARGETS"
			? "TARGETS\ntext/uri-list\nx-special/gnome-copied-files\napplication/x-kde-cutselection\n"
			: `file://${encodeURI(pdf)}\r\nfile://${join(dir, "folder")}\r\nfile://${join(dir, "gone.txt")}\r\n`,
	);
	expect(await readNativeClipboard(native.read, { env: X11, spawn: helper.spawn })).toEqual({
		kind: "files",
		files: [{ path: pdf, name: "My Notes.pdf", size: 4 }],
	});
	expect(helper.commands).toEqual([TARGETS, xclipRead("text/uri-list")]);
	expect(native.calls).toEqual([]);
});

test("a file list falls back from the URI list to GNOME's copied-files target and the text target", async () => {
	const pdf = join(dir, "design.pdf");
	writeFileSync(pdf, "%PDF-1.7");
	const answers: Record<string, Answer> = {
		TARGETS: "TARGETS\ntext/uri-list\nx-special/gnome-copied-files\nUTF8_STRING",
		"text/uri-list": "https://example.com/a.pdf",
		"x-special/gnome-copied-files": { code: 1 },
		UTF8_STRING: pdf,
	};
	const helper = helpers((command) => answers[command.at(-1) ?? ""] ?? "missing");
	expect(
		await readNativeClipboard(electrobun([], null).read, { env: X11, spawn: helper.spawn }),
	).toEqual({ kind: "files", files: [{ path: pdf, name: "design.pdf", size: 8 }] });
	expect(helper.commands).toEqual([
		TARGETS,
		xclipRead("text/uri-list"),
		xclipRead("x-special/gnome-copied-files"),
		xclipRead("UTF8_STRING"),
	]);
});

test("a text-only copy is a file list only in GNOME's copied-files form or as file:// URIs; bare paths stay text", async () => {
	const pdf = join(dir, "My Notes.pdf");
	const png = join(dir, "shot.png");
	writeFileSync(pdf, "%PDF");
	writeFileSync(png, new Uint8Array([1, 2]));
	const textOnly = (text: string) =>
		helpers((command) =>
			command.at(-1) === "TARGETS"
				? "TIMESTAMP\nTARGETS\nUTF8_STRING\nCOMPOUND_TEXT\nTEXT\nSTRING\ntext/plain;charset=utf-8\ntext/plain"
				: text,
		);
	const read = (text: string) =>
		readNativeClipboard(electrobun(["text"], text).read, { env: X11, spawn: textOnly(text).spawn });
	const both: NativeClipboardContent = {
		kind: "files",
		files: [
			{ path: pdf, name: "My Notes.pdf", size: 4 },
			{ path: png, name: "shot.png", size: 2, image: { mimeType: "image/png", data: "AQI=" } },
		],
	};
	const uris = [pdf, png].map((path) => `file://${encodeURI(path)}`).join("\n");
	expect(await read(`x-special/nautilus-clipboard\ncopy\n${uris}\n`)).toEqual(both);
	expect(await read(`cut\n${uris}`)).toEqual(both);
	expect(await read(uris)).toEqual(both);
	expect(await read(`${pdf}\n${png}`)).toEqual({ kind: "none" });
	expect(await read(`copy\nfile://${join(dir, "gone.pdf")}`)).toEqual({ kind: "none" });
	const helper = textOnly(uris);
	await readNativeClipboard(electrobun([], null).read, { env: X11, spawn: helper.spawn });
	expect(helper.commands).toEqual([TARGETS, xclipRead("text/plain;charset=utf-8")]);
});

test("a screenshot is read as the owner's PNG bytes by the helper, without GTK's decode", async () => {
	const native = electrobun(["image"], null, new Uint8Array([9]));
	const helper = helpers((command) =>
		command.at(-1) === "TARGETS" ? "TARGETS\nimage/png\nimage/jpeg" : new Uint8Array([1, 2, 3]),
	);
	expect(await readNativeClipboard(native.read, { env: X11, spawn: helper.spawn })).toEqual({
		kind: "image",
		mimeType: "image/png",
		data: "AQID",
	});
	expect(helper.commands).toEqual([TARGETS, xclipRead("image/png")]);
	expect(native.calls).toEqual([]);
});

test("a browser image copy with a web URL in its URI list still pastes the image", async () => {
	const helper = helpers((command) => {
		if (command.at(-1) === "TARGETS") return "text/uri-list\ntext/html\nimage/png";
		return command.at(-1) === "text/uri-list" ? "https://example.com/a.png" : new Uint8Array([1]);
	});
	expect(
		await readNativeClipboard(electrobun([], null).read, { env: X11, spawn: helper.spawn }),
	).toEqual({ kind: "image", mimeType: "image/png", data: "AQ==" });
});

test("plain text and an empty clipboard read as nothing", async () => {
	const prose = helpers((command) => (command.at(-1) === "TARGETS" ? "TARGETS\nUTF8_STRING" : "x"));
	expect(
		await readNativeClipboard(electrobun([], null).read, { env: X11, spawn: prose.spawn }),
	).toEqual({ kind: "none" });
	expect(prose.commands).toEqual([TARGETS, xclipRead("UTF8_STRING")]);
	const listedOnly = helpers((command) =>
		command.at(-1) === "TARGETS" ? "text/uri-list" : "https://example.com",
	);
	expect(
		await readNativeClipboard(electrobun([], null).read, { env: X11, spawn: listedOnly.spawn }),
	).toEqual({ kind: "unreadable" });
});

test("wl-paste is tried first on Wayland, then xclip when wl-paste is missing", async () => {
	const helper = helpers((command) => {
		if (command[0] === "wl-paste") return "missing";
		return command.at(-1) === "TARGETS" ? "image/png" : new Uint8Array([1]);
	});
	await readNativeClipboard(electrobun([], null).read, {
		env: { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" },
		spawn: helper.spawn,
	});
	expect(helper.commands).toEqual(["wl-paste --list-types", TARGETS, xclipRead("image/png")]);
	const wayland = helpers((command) => (command.at(-1) === "--list-types" ? "image/png" : "png"));
	await readNativeClipboard(electrobun([], null).read, {
		env: { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" },
		spawn: wayland.spawn,
	});
	expect(wayland.commands).toEqual([
		"wl-paste --list-types",
		"wl-paste --no-newline --type image/png",
	]);
});

test("Electrobun's calls run only when no helper is available", async () => {
	const pdf = join(dir, "design.pdf");
	const png = join(dir, "My Shot.png");
	writeFileSync(pdf, "%PDF-1.7");
	writeFileSync(png, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
	const missing = helpers(() => "missing");
	const files = electrobun(["text", "files"], `${pdf}\nfile://${encodeURI(png)}`);
	expect(await readNativeClipboard(files.read, { env: X11, spawn: missing.spawn })).toEqual({
		kind: "files",
		files: [
			{ path: pdf, name: "design.pdf", size: 8 },
			{
				path: png,
				name: "My Shot.png",
				size: 4,
				image: { mimeType: "image/png", data: "iVBORw==" },
			},
		],
	});
	expect(files.calls).toEqual(["formats", "text"]);
	const image = electrobun(["image"], null, new Uint8Array([1, 2, 3]));
	expect(await readNativeClipboard(image.read, { env: {}, spawn: missing.spawn })).toEqual({
		kind: "image",
		mimeType: "image/png",
		data: "AQID",
	});
	const prose = electrobun(["text"], "/etc/hosts");
	expect(await readNativeClipboard(prose.read, { env: {}, spawn: missing.spawn })).toEqual({
		kind: "none",
	});
	expect(prose.calls).toEqual(["formats", "text"]);
	const nautilus = electrobun(["text"], `x-special/nautilus-clipboard\ncopy\nfile://${pdf}\n`);
	expect(await readNativeClipboard(nautilus.read, { env: {}, spawn: missing.spawn })).toEqual({
		kind: "files",
		files: [{ path: pdf, name: "design.pdf", size: 8 }],
	});
	expect(
		await readNativeClipboard(electrobun(["files"], null).read, { env: {}, spawn: missing.spawn }),
	).toEqual({ kind: "unreadable" });
});

test("a clipboard owner that stops answering is killed at the timeout, without falling back to Electrobun", async () => {
	const native = electrobun(["files"], null);
	const listing = helpers(() => "hang");
	expect(
		await readNativeClipboard(native.read, { env: X11, spawn: listing.spawn, limits: FAST }),
	).toEqual({ kind: "unreadable" });
	expect(listing.killed).toEqual([TARGETS]);
	const reading = helpers((command) => (command.at(-1) === "TARGETS" ? "image/png" : "hang"));
	expect(
		await readNativeClipboard(native.read, {
			env: X11,
			spawn: reading.spawn,
			limits: { ...FAST, deadlineMs: 40 },
		}),
	).toEqual({ kind: "unreadable" });
	expect(reading.killed).toEqual([xclipRead("image/png")]);
	expect(native.calls).toEqual([]);
});

test("an image past the read's budget is cut off and reads as oversized", async () => {
	const limits = { ...CLIPBOARD_LIMITS, imageBudgetBytes: 4 };
	const helper = helpers((command) =>
		command.at(-1) === "TARGETS" ? "image/png" : new Uint8Array([1, 2, 3, 4, 5]),
	);
	expect(
		await readNativeClipboard(electrobun([], null).read, {
			env: X11,
			spawn: helper.spawn,
			limits,
		}),
	).toEqual({ kind: "oversized" });
	expect(helper.killed).toEqual([xclipRead("image/png")]);
	const native = electrobun(["image"], null, new Uint8Array([1, 2, 3, 4, 5]));
	expect(await readNativeClipboard(native.read, { env: {}, limits })).toEqual({
		kind: "oversized",
	});
});

test("copied image files share one byte budget; past it they come by path, and HEIC, TIFF and AVIF are images too", async () => {
	const big = join(dir, "big.png");
	const second = join(dir, "second.jpg");
	const heic = join(dir, "photo.heic");
	const tiff = join(dir, "scan.tiff");
	const avif = join(dir, "frame.avif");
	const pdf = join(dir, "notes.pdf");
	writeFileSync(big, new Uint8Array(6));
	writeFileSync(second, new Uint8Array(6));
	writeFileSync(heic, new Uint8Array([1]));
	writeFileSync(tiff, new Uint8Array([2]));
	writeFileSync(avif, new Uint8Array([3]));
	writeFileSync(pdf, "%PDF");
	const helper = helpers((command) =>
		command.at(-1) === "TARGETS"
			? "text/uri-list"
			: [big, second, heic, tiff, avif, pdf].map((path) => `file://${path}`).join("\n"),
	);
	const content = await readNativeClipboard(electrobun([], null).read, {
		env: X11,
		spawn: helper.spawn,
		limits: { ...CLIPBOARD_LIMITS, imageBudgetBytes: 9 },
	});
	expect(content).toEqual({
		kind: "files",
		files: [
			{ path: big, name: "big.png", size: 6, image: { mimeType: "image/png", data: "AAAAAAAA" } },
			{ path: second, name: "second.jpg", size: 6 },
			{ path: heic, name: "photo.heic", size: 1, image: { mimeType: "image/heic", data: "AQ==" } },
			{ path: tiff, name: "scan.tiff", size: 1, image: { mimeType: "image/tiff", data: "Ag==" } },
			{ path: avif, name: "frame.avif", size: 1, image: { mimeType: "image/avif", data: "Aw==" } },
			{ path: pdf, name: "notes.pdf", size: 4 },
		],
	});
});

test("the bridge answers nothing when the native read fails", async () => {
	const bridge = createClipboardBridge(() => Promise.reject(new Error("rpc timeout")));
	expect(await bridge.read()).toEqual({ kind: "none" });
	expect(Object.isFrozen(bridge)).toBe(true);
});
