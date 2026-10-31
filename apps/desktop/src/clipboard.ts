import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { extname, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { NativeClipboardFile } from "@thinkrail/contracts";

const MAX_OUTPUT = 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 256;
const READ_TIMEOUT = 3000;

const MAC_SCRIPT = `ObjC.import('AppKit');
var urls = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions(
  $([$.NSURL]), $({ NSPasteboardURLReadingFileURLsOnlyKey: true })
);
var paths = [];
if (urls) {
  for (var i = 0; i < urls.count; i++) {
    var url = urls.objectAtIndex(i);
    if (url.isFileURL) paths.push(ObjC.unwrap(url.path));
  }
}
JSON.stringify(paths);`;

const WINDOWS_SCRIPT = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$files = @([System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [string]$_ })
ConvertTo-Json -InputObject $files -Compress`;

type CommandResult = { exitCode: number; stdout: string; stderr: string };
export type ClipboardCommandRunner = (
	command: string[],
	limits: { timeout: number; maxBuffer: number },
) => Promise<CommandResult>;

class ClipboardError extends Error {
	constructor(readonly code: string) {
		super("Native clipboard file read failed");
		this.name = "ClipboardError";
	}
}

export const runClipboardCommand: ClipboardCommandRunner = (command, limits) =>
	new Promise((resolve, reject) => {
		const [executable, ...args] = command;
		if (!executable) return reject(new ClipboardError("CLIPBOARD_COMMAND_FAILED"));
		execFile(
			executable,
			args,
			{ ...limits, encoding: "utf8", windowsHide: true },
			(error, stdout, stderr) => {
				if (error) {
					if (error.code === "ENOENT")
						return reject(new ClipboardError("CLIPBOARD_HELPER_MISSING"));
					if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
						return reject(new ClipboardError("CLIPBOARD_OUTPUT_LIMIT"));
					if (error.killed) return reject(new ClipboardError("CLIPBOARD_TIMEOUT"));
					if (typeof error.code !== "number")
						return reject(new ClipboardError("CLIPBOARD_COMMAND_FAILED"));
				}
				resolve({ exitCode: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
			},
		);
	});

function filePath(value: unknown, platform: NodeJS.Platform): string | null {
	if (typeof value !== "string" || /\p{Cc}/u.test(value)) return null;
	let path = value;
	if (/^file:/i.test(value)) {
		try {
			const url = new URL(value);
			if (url.search || url.hash) return null;
			path = fileURLToPath(url, { windows: platform === "win32" });
		} catch {
			return null;
		}
	}
	if (/\p{Cc}/u.test(path)) return null;
	if (platform === "win32") {
		if (!/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(path)) return null;
		if (/^\\\\[?.]\\/.test(path)) return null;
		return win32.isAbsolute(path) ? path : null;
	}
	return posix.isAbsolute(path) ? path : null;
}

export function parseClipboardFiles(
	output: string,
	format: "json" | "uri-list" | "copied-files",
	platform: NodeJS.Platform,
): string[] {
	let values: unknown[];
	if (format === "json") {
		try {
			const parsed: unknown = JSON.parse(output.replace(/^\uFEFF/, ""));
			if (!Array.isArray(parsed)) throw new ClipboardError("CLIPBOARD_INVALID_RESPONSE");
			values = parsed;
		} catch {
			throw new ClipboardError("CLIPBOARD_INVALID_RESPONSE");
		}
	} else {
		const lines = output.split(/\r?\n/);
		if (format === "copied-files") {
			const action = lines.shift();
			if (action !== "copy" && action !== "cut")
				throw new ClipboardError("CLIPBOARD_INVALID_RESPONSE");
		}
		values = lines.filter((line) => /^file:/i.test(line));
	}
	if (values.length > MAX_FILES) throw new ClipboardError("CLIPBOARD_FILE_LIMIT");
	return values.map((value) => {
		const path = filePath(value, platform);
		if (path === null) throw new ClipboardError("CLIPBOARD_INVALID_PATH");
		return path;
	});
}

async function clipboardPaths(
	platform: NodeJS.Platform,
	run: ClipboardCommandRunner,
	env: Readonly<NodeJS.ProcessEnv>,
): Promise<string[]> {
	const deadline = Date.now() + READ_TIMEOUT;
	const execute = async (command: string[]) => {
		const timeout = deadline - Date.now();
		if (timeout <= 0) throw new ClipboardError("CLIPBOARD_TIMEOUT");
		const result = await run(command, { timeout, maxBuffer: MAX_OUTPUT });
		if (
			Buffer.byteLength(result.stdout) > MAX_OUTPUT ||
			Buffer.byteLength(result.stderr) > MAX_OUTPUT
		) {
			throw new ClipboardError("CLIPBOARD_OUTPUT_LIMIT");
		}
		return result;
	};
	if (platform === "darwin" || platform === "win32") {
		const result = await execute(
			platform === "darwin"
				? ["/usr/bin/osascript", "-l", "JavaScript", "-e", MAC_SCRIPT]
				: ["powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-Command", WINDOWS_SCRIPT],
		);
		if (result.exitCode !== 0) throw new ClipboardError("CLIPBOARD_COMMAND_FAILED");
		return parseClipboardFiles(result.stdout, "json", platform);
	}
	if (platform !== "linux") throw new ClipboardError("CLIPBOARD_PLATFORM_UNSUPPORTED");
	const helpers = env.WAYLAND_DISPLAY ? ["wl-paste", "xclip"] : ["xclip", "wl-paste"];
	for (const helper of helpers) {
		let targets: CommandResult;
		try {
			targets = await execute(
				helper === "wl-paste"
					? [helper, "--list-types"]
					: [helper, "-selection", "clipboard", "-out", "-target", "TARGETS"],
			);
		} catch (error) {
			if (error instanceof ClipboardError && error.code === "CLIPBOARD_HELPER_MISSING") continue;
			throw error;
		}
		if (targets.exitCode !== 0) {
			if (
				targets.exitCode === 1 &&
				(targets.stderr.trim() === "Nothing is copied" ||
					targets.stderr.trim() === "Error: target TARGETS not available")
			)
				return [];
			throw new ClipboardError("CLIPBOARD_COMMAND_FAILED");
		}
		const types = targets.stdout.split(/\r?\n/);
		const type = ["text/uri-list", "x-special/gnome-copied-files"].find((candidate) =>
			types.includes(candidate),
		);
		if (!type) return [];
		const result = await execute(
			helper === "wl-paste"
				? [helper, "--no-newline", "--type", type]
				: [helper, "-selection", "clipboard", "-out", "-target", type],
		);
		if (result.exitCode !== 0) throw new ClipboardError("CLIPBOARD_COMMAND_FAILED");
		return parseClipboardFiles(
			result.stdout,
			type === "text/uri-list" ? "uri-list" : "copied-files",
			platform,
		);
	}
	throw new ClipboardError("CLIPBOARD_HELPER_MISSING");
}

const IMAGE_MIME: Readonly<Record<string, string>> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".jfif": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".avif": "image/avif",
	".heic": "image/heic",
	".heif": "image/heif",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
	".jxl": "image/jxl",
};

export async function readClipboardFiles(
	options: {
		platform?: NodeJS.Platform;
		run?: ClipboardCommandRunner;
		env?: Readonly<NodeJS.ProcessEnv>;
	} = {},
): Promise<NativeClipboardFile[]> {
	const platform = options.platform ?? process.platform;
	const paths = await clipboardPaths(
		platform,
		options.run ?? runClipboardCommand,
		options.env ?? process.env,
	);
	let remaining = MAX_IMAGE_BYTES;
	const files: NativeClipboardFile[] = [];
	for (const path of paths) {
		const file: NativeClipboardFile = { path };
		files.push(file);
		const mimeType = IMAGE_MIME[extname(path).toLowerCase()];
		if (!mimeType || remaining <= 0 || (platform === "win32" && path.startsWith("\\\\"))) continue;
		try {
			const before = await lstat(path);
			if (!before.isFile() || before.size <= 0 || before.size > remaining) continue;
			const handle = await open(
				path,
				constants.O_RDONLY |
					(process.platform === "win32" ? 0 : constants.O_NONBLOCK | constants.O_NOFOLLOW),
			);
			try {
				const stat = await handle.stat();
				if (
					!stat.isFile() ||
					stat.ino !== before.ino ||
					stat.dev !== before.dev ||
					stat.size <= 0 ||
					stat.size > remaining
				)
					continue;
				const bytes = Buffer.alloc(stat.size);
				let offset = 0;
				while (offset < bytes.length) {
					const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
					remaining -= bytesRead;
					if (bytesRead === 0) break;
					offset += bytesRead;
				}
				const after = await handle.stat();
				if (offset === bytes.length && after.size === stat.size && after.mtimeMs === stat.mtimeMs) {
					file.image = { data: bytes.toString("base64"), mimeType };
				}
			} finally {
				await handle.close();
			}
		} catch {}
	}
	return files;
}
