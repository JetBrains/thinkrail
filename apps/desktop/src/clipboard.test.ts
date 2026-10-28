import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type ClipboardCommandRunner,
	parseClipboardFiles,
	readClipboardFiles,
	runClipboardCommand,
} from "./clipboard";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function fixture() {
	const path = await mkdtemp(join(tmpdir(), "thinkrail-clipboard-"));
	directories.push(path);
	return path;
}
const result = (stdout: string, exitCode = 0, stderr = "") => ({ stdout, exitCode, stderr });
const jsonRunner =
	(paths: string[]): ClipboardCommandRunner =>
	async () =>
		result(JSON.stringify(paths));

test("JSON paths preserve spaces, Unicode, order, and duplicates; reject relative and control paths", () => {
	expect(
		parseClipboardFiles(
			JSON.stringify(["/tmp/  文档.txt ", "file:///tmp/a%20b", "/tmp/  文档.txt "]),
			"json",
			"darwin",
		),
	).toEqual(["/tmp/  文档.txt ", "/tmp/a b", "/tmp/  文档.txt "]);
});

test("Windows drive paths, UNC and file URLs are accepted, drive-relative and device paths rejected", () => {
	expect(
		parseClipboardFiles(
			JSON.stringify([
				"C:\\My Files\\文档.txt",
				"\\\\server\\share\\a b",
				"file:///D:/My%20Files/p.png",
				"file://server/share/a%20b",
			]),
			"json",
			"win32",
		),
	).toEqual([
		"C:\\My Files\\文档.txt",
		"\\\\server\\share\\a b",
		"D:\\My Files\\p.png",
		"\\\\server\\share\\a b",
	]);
});

test("URI and GNOME copied-files lists preserve names and reject invalid URLs", () => {
	expect(
		parseClipboardFiles(
			"# comment\r\nfile:///tmp/a%20b\r\nfile:///tmp/%E4%B8%AD\r\n",
			"uri-list",
			"linux",
		),
	).toEqual(["/tmp/a b", "/tmp/中"]);
	expect(parseClipboardFiles("cut\nfile:///tmp/a\n/tmp/b \n", "copied-files", "linux")).toEqual([
		"/tmp/a",
	]);
	expect(() => parseClipboardFiles("paste\nfile:///a", "copied-files", "linux")).toThrow();
	for (const output of ["", "null", "{}", '"/tmp/a"', "[broken"]) {
		expect(() => parseClipboardFiles(output, "json", "darwin")).toThrow();
	}
});

test("rejected file paths fail closed instead of enabling clipboard icon fallback", () => {
	for (const [platform, invalid] of [
		[
			"darwin",
			[
				"relative",
				"https://example.com/a",
				"/tmp/a\nb",
				"/tmp/a\u0085b",
				"file:///tmp/a%0Ab",
				"file://remote/tmp/a",
				"file:///tmp/a?b",
			],
		],
		[
			"win32",
			["C:relative", "\\rooted", "\\\\?\\C:\\secret", "\\\\.\\PhysicalDrive0", "C:\\a\u0000b"],
		],
	] as const) {
		for (const path of invalid) {
			expect(() => parseClipboardFiles(JSON.stringify([path]), "json", platform)).toThrow(
				"Native clipboard file read failed",
			);
		}
	}
	expect(() =>
		parseClipboardFiles("file:///tmp/good\nfile:///tmp/%zz", "uri-list", "linux"),
	).toThrow();
	expect(() =>
		parseClipboardFiles(JSON.stringify(["/tmp/good", "/tmp/a\nb"]), "json", "darwin"),
	).toThrow();
});

test("file lists are bounded instead of silently truncated", () => {
	for (const format of ["json", "uri-list", "copied-files"] as const) {
		const paths = Array.from({ length: 257 }, (_, index) => `file:///tmp/${index}.png`);
		const output =
			format === "json"
				? JSON.stringify(paths)
				: `${format === "copied-files" ? "copy\n" : ""}${paths.join("\n")}`;
		expect(() => parseClipboardFiles(output, format, "darwin")).toThrow();
		try {
			parseClipboardFiles(output, format, "darwin");
		} catch (error) {
			expect(error).toMatchObject({ code: "CLIPBOARD_FILE_LIMIT" });
		}
	}
});

test("macOS uses a fixed AppKit JXA command and Windows uses fixed STA UTF8 JSON PowerShell", async () => {
	for (const platform of ["darwin", "win32"] as const) {
		const calls: string[][] = [];
		await expect(
			readClipboardFiles({
				platform,
				run: async (command, limits) => {
					calls.push(command);
					expect(limits.timeout).toBeGreaterThan(0);
					expect(limits.timeout).toBeLessThanOrEqual(3000);
					expect(limits.maxBuffer).toBe(1024 * 1024);
					return result("[]");
				},
			}),
		).resolves.toEqual([]);
		const command = calls[0];
		expect(calls).toHaveLength(1);
		if (platform === "darwin") {
			expect(command?.slice(0, 4)).toEqual(["/usr/bin/osascript", "-l", "JavaScript", "-e"]);
			expect(command?.[4]).toContain("NSPasteboardURLReadingFileURLsOnlyKey");
		} else {
			expect(command?.slice(0, 5)).toEqual([
				"powershell.exe",
				"-NoProfile",
				"-NonInteractive",
				"-STA",
				"-Command",
			]);
			expect(command?.[5]).toContain("System.Windows.Forms.Clipboard]::GetFileDropList()");
			expect(command?.[5]).toContain("UTF8Encoding($false)");
			expect(command?.[5]).toContain("ConvertTo-Json -InputObject $files");
		}
	}
});

test("Linux selects Wayland URI-list or X11 GNOME targets without interpolating clipboard values", async () => {
	for (const wayland of [true, false]) {
		const calls: string[][] = [];
		const type = wayland ? "text/uri-list" : "x-special/gnome-copied-files";
		const files = await readClipboardFiles({
			platform: "linux",
			env: wayland ? { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" } : { DISPLAY: ":0" },
			run: async (command) => {
				calls.push(command);
				return result(
					calls.length === 1
						? `text/plain\n${type}\n`
						: `${wayland ? "" : "copy\n"}file:///tmp/a%20%24(b).txt\n`,
				);
			},
		});
		expect(files).toEqual([{ path: "/tmp/a $(b).txt" }]);
		expect(calls).toEqual(
			wayland
				? [
						["wl-paste", "--list-types"],
						["wl-paste", "--no-newline", "--type", type],
					]
				: [
						["xclip", "-selection", "clipboard", "-out", "-target", "TARGETS"],
						["xclip", "-selection", "clipboard", "-out", "-target", type],
					],
		);
	}
});

test("empty and non-file clipboards differ from command, parse and output failures", async () => {
	await expect(readClipboardFiles({ platform: "darwin", run: jsonRunner([]) })).resolves.toEqual(
		[],
	);
	await expect(
		readClipboardFiles({ platform: "linux", run: async () => result("text/plain\n") }),
	).resolves.toEqual([]);
	await expect(
		readClipboardFiles({
			platform: "linux",
			run: async () => result("", 1, "Nothing is copied\n"),
		}),
	).resolves.toEqual([]);
	await expect(
		readClipboardFiles({
			platform: "linux",
			run: async () => result("", 1, "Error: target TARGETS not available\n"),
		}),
	).resolves.toEqual([]);
	for (const platform of ["darwin", "win32", "linux"] as const) {
		await expect(
			readClipboardFiles({ platform, run: async () => result("", 1, "private path") }),
		).rejects.toMatchObject({ code: "CLIPBOARD_COMMAND_FAILED" });
	}
	await expect(
		readClipboardFiles({ platform: "darwin", run: async () => result("bad") }),
	).rejects.toMatchObject({ code: "CLIPBOARD_INVALID_RESPONSE" });
	await expect(
		readClipboardFiles({
			platform: "darwin",
			run: async () => result("x".repeat(1024 * 1024 + 1)),
		}),
	).rejects.toMatchObject({ code: "CLIPBOARD_OUTPUT_LIMIT" });
	await expect(
		readClipboardFiles({ platform: "freebsd", run: jsonRunner([]) }),
	).rejects.toMatchObject({ code: "CLIPBOARD_PLATFORM_UNSUPPORTED" });
});

test("missing Linux helpers fail; missing preferred helper falls back to the other backend", async () => {
	const missing: ClipboardCommandRunner = (_command, limits) =>
		runClipboardCommand(["/thinkrail-nonexistent-clipboard-helper"], limits);
	await expect(readClipboardFiles({ platform: "linux", run: missing })).rejects.toMatchObject({
		code: "CLIPBOARD_HELPER_MISSING",
	});
	const calls: string[] = [];
	await expect(
		readClipboardFiles({
			platform: "linux",
			env: { WAYLAND_DISPLAY: "wayland-0" },
			run: async (command, limits) => {
				calls.push(command[0] ?? "");
				return command[0] === "wl-paste" ? missing(command, limits) : result("text/plain\n");
			},
		}),
	).resolves.toEqual([]);
	expect(calls).toEqual(["wl-paste", "xclip"]);
});

test("real command runner bounds output and time without accessing the clipboard", async () => {
	await expect(
		runClipboardCommand([process.execPath, "-e", 'process.stdout.write("x".repeat(20000))'], {
			timeout: 2000,
			maxBuffer: 1024,
		}),
	).rejects.toMatchObject({ code: "CLIPBOARD_OUTPUT_LIMIT" });
	await expect(
		runClipboardCommand([process.execPath, "-e", "setTimeout(() => {}, 10000)"], {
			timeout: 30,
			maxBuffer: 1024,
		}),
	).rejects.toMatchObject({ code: "CLIPBOARD_TIMEOUT" });
});

test("only regular candidate images get bounded bytes; documents, folders, missing and symlink files remain paths", async () => {
	const root = await fixture();
	const png = join(root, "图片.PNG");
	const heic = join(root, "photo.heic");
	const text = join(root, "document.txt");
	const directory = join(root, "folder.png");
	const missing = join(root, "missing.jpg");
	const link = join(root, "link.png");
	await writeFile(png, new Uint8Array([1, 2, 3]));
	await writeFile(heic, "heic");
	await writeFile(text, "not injected");
	await mkdir(directory);
	const paths = [png, text, directory, missing, heic];
	if (process.platform !== "win32") {
		await symlink(png, link);
		paths.push(link);
		const fifo = join(root, "pipe.png");
		execFileSync("mkfifo", [fifo]);
		paths.push(fifo);
	}
	const files = await readClipboardFiles({
		platform: process.platform === "win32" ? "win32" : "darwin",
		run: jsonRunner(paths),
	});
	expect(files).toEqual(
		paths.map((path) =>
			path === png
				? { path, image: { data: "AQID", mimeType: "image/png" } }
				: path === heic
					? {
							path,
							image: { data: Buffer.from("heic").toString("base64"), mimeType: "image/heic" },
						}
					: { path },
		),
	);
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
	"an unreadable image falls back to its path",
	async () => {
		const root = await fixture();
		const path = join(root, "unreadable.png");
		await writeFile(path, "private bytes");
		await chmod(path, 0);
		await expect(
			readClipboardFiles({ platform: "darwin", run: jsonRunner([path]) }),
		).resolves.toEqual([{ path }]);
	},
);

test("images larger than remaining 32MiB are paths and do not prevent later smaller attachments", async () => {
	const root = await fixture();
	const paths = ["large.png", "first.png", "over.png", "last.png", "exhausted.png"].map((name) =>
		join(root, name),
	);
	const sizes = [32 * 1024 * 1024 + 1, 20 * 1024 * 1024, 13 * 1024 * 1024, 12 * 1024 * 1024, 1];
	for (const [index, path] of paths.entries()) {
		await writeFile(path, "");
		await truncate(path, sizes[index]);
	}
	const files = await readClipboardFiles({
		platform: process.platform === "win32" ? "win32" : "darwin",
		run: jsonRunner(paths),
	});
	expect(files.map((file) => file.image !== undefined)).toEqual([false, true, false, true, false]);
	expect(
		files.reduce(
			(sum, file) => sum + (file.image ? Buffer.from(file.image.data, "base64").length : 0),
			0,
		),
	).toBe(32 * 1024 * 1024);
});

test.skipIf(process.platform !== "darwin")(
	"JXA executes against synthetic NSURLs, never the real pasteboard",
	async () => {
		let script = "";
		await readClipboardFiles({
			platform: "darwin",
			run: async (command) => {
				script = command[4] ?? "";
				return result("[]");
			},
		});
		const original = "$.NSPasteboard.generalPasteboard";
		expect(script).toContain(original);
		for (const urls of ["$([])", "$([$.NSURL.fileURLWithPath('/tmp/文档 a.txt')])", "$(null)"]) {
			const synthetic = script.replace(
				original,
				`({readObjectsForClassesOptions: function() { return ${urls}; }})`,
			);
			expect(synthetic).not.toContain(original);
			const output = await runClipboardCommand(
				["/usr/bin/osascript", "-l", "JavaScript", "-e", synthetic],
				{ timeout: 3000, maxBuffer: 1024 },
			);
			expect(output.exitCode).toBe(0);
			expect(parseClipboardFiles(output.stdout, "json", "darwin")).toEqual(
				urls.includes("fileURLWithPath") ? ["/tmp/文档 a.txt"] : [],
			);
		}
	},
);

test("file URI decoding works with disposable filesystem fixtures", async () => {
	const root = await fixture();
	const path = join(root, "has # space %.png");
	await writeFile(path, "bytes");
	const files = await readClipboardFiles({
		platform: process.platform === "win32" ? "win32" : "darwin",
		run: jsonRunner([pathToFileURL(path).href]),
	});
	expect(files[0]).toEqual({ path, image: { data: "Ynl0ZXM=", mimeType: "image/png" } });
});
