import { describe, expect, test } from "bun:test";
import {
	parseUpdateArgs,
	resolveUpdatePlan,
	resolveWindowsPrefix,
	windowsUpdateMessage,
} from "./update";

describe("parseUpdateArgs", () => {
	test("defaults to latest, no channel override", () => {
		expect(parseUpdateArgs([])).toEqual({ version: "latest" });
	});

	test("reads --channel and --version (space + = forms)", () => {
		expect(parseUpdateArgs(["--channel", "nightly", "--version", "0.2.0"])).toEqual({
			channel: "nightly",
			version: "0.2.0",
		});
		expect(parseUpdateArgs(["--channel=stable", "--version=1.2.3-nightly.4"])).toEqual({
			channel: "stable",
			version: "1.2.3-nightly.4",
		});
	});

	test("rejects a bad channel, version, or unknown flag", () => {
		expect(() => parseUpdateArgs(["--channel", "beta"])).toThrow("Invalid --channel: beta");
		expect(() => parseUpdateArgs(["--version", "v1.2.3"])).toThrow("Invalid --version: v1.2.3");
		expect(() => parseUpdateArgs(["--nope"])).toThrow("Unknown option: --nope");
		expect(() => parseUpdateArgs(["--channel"])).toThrow("Missing value for --channel");
	});
});

describe("resolveUpdatePlan", () => {
	const home = "/home/u";

	test("flag channel wins over metadata and baked", () => {
		const plan = resolveUpdatePlan({
			args: { channel: "nightly", version: "latest" },
			installMeta: { channel: "stable", prefix: "/home/u/.local" },
			baked: "stable",
			home,
		});
		expect(plan.channel).toBe("nightly");
		expect(plan.bashArgs).toEqual([
			"-s",
			"--",
			"--channel",
			"nightly",
			"--prefix",
			"/home/u/.local",
		]);
	});

	test("falls back metadata → baked → stable, and default prefix", () => {
		expect(
			resolveUpdatePlan({
				args: { version: "latest" },
				installMeta: { channel: "nightly" },
				baked: "stable",
				home,
			}).channel,
		).toBe("nightly");
		expect(
			resolveUpdatePlan({ args: { version: "latest" }, installMeta: {}, baked: "nightly", home })
				.channel,
		).toBe("nightly");
		const dev = resolveUpdatePlan({
			args: { version: "latest" },
			installMeta: {},
			baked: "dev",
			home,
		});
		expect(dev.channel).toBe("stable");
		expect(dev.prefix).toBe("/home/u/.local");
	});

	test("appends --version only when pinned", () => {
		const pinned = resolveUpdatePlan({
			args: { version: "0.3.0" },
			installMeta: {},
			baked: "stable",
			home,
		});
		expect(pinned.bashArgs).toEqual([
			"-s",
			"--",
			"--channel",
			"stable",
			"--prefix",
			"/home/u/.local",
			"--version",
			"0.3.0",
		]);
	});

	test("rejects an unsafe or relative prefix from metadata", () => {
		expect(() =>
			resolveUpdatePlan({
				args: { version: "latest" },
				installMeta: { prefix: "/tmp/$(rm -rf ~)" },
				baked: "stable",
				home,
			}),
		).toThrow("suspicious install prefix");
		expect(() =>
			resolveUpdatePlan({
				args: { version: "latest" },
				installMeta: { prefix: "relative/dir" },
				baked: "stable",
				home,
			}),
		).toThrow("suspicious install prefix");
	});
});

describe("windowsUpdateMessage", () => {
	const psLine = (msg: string) => msg.split("\n").find((l) => l.includes("PowerShell:")) ?? "";
	const cmdLine = (msg: string) => msg.split("\n").find((l) => l.includes("cmd:")) ?? "";

	test("stable/latest is one bare command per shell", () => {
		const msg = windowsUpdateMessage("stable", "latest");
		expect(psLine(msg)).toContain(
			"irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex",
		);
		expect(cmdLine(msg)).toContain('powershell -c "irm ');
		expect(msg).not.toContain("THINKRAIL_CHANNEL");
		expect(msg).not.toContain("THINKRAIL_VERSION");
	});

	test("carries the channel in each shell's own env syntax", () => {
		const msg = windowsUpdateMessage("nightly", "latest");
		// The bug this pins: a single cmd-syntax `set "X=v"` shown to PowerShell users, where `set` is
		// Set-Variable and never reaches the child process -> a silent downgrade to stable.
		expect(psLine(msg)).toContain("$env:THINKRAIL_CHANNEL='nightly';");
		expect(psLine(msg)).not.toContain('set "');
		expect(cmdLine(msg)).toContain('set "THINKRAIL_CHANNEL=nightly" &&');
		expect(cmdLine(msg)).not.toContain("$env:");
	});

	test("carries a pinned version too", () => {
		const msg = windowsUpdateMessage("nightly", "0.2.0");
		expect(psLine(msg)).toContain(
			"$env:THINKRAIL_CHANNEL='nightly'; $env:THINKRAIL_VERSION='0.2.0';",
		);
		expect(cmdLine(msg)).toContain(
			'set "THINKRAIL_CHANNEL=nightly" && set "THINKRAIL_VERSION=0.2.0" &&',
		);
	});

	test("carries a custom prefix, so the re-install lands where this one did", () => {
		// Without it the user re-installs under the default `.local` while the PATH-resolved
		// D:\tools\bin\thinkrail.exe stays on the old build.
		const msg = windowsUpdateMessage("stable", "latest", "D:\\tools");
		expect(psLine(msg)).toContain("$env:THINKRAIL_PREFIX='D:\\tools';");
		expect(cmdLine(msg)).toContain('set "THINKRAIL_PREFIX=D:\\tools" &&');
	});

	test("escapes a quote-bearing prefix for PowerShell", () => {
		const msg = windowsUpdateMessage("stable", "latest", "D:\\o'brien\\tools");
		expect(psLine(msg)).toContain("$env:THINKRAIL_PREFIX='D:\\o''brien\\tools';");
		expect(cmdLine(msg)).toContain('set "THINKRAIL_PREFIX=D:\\o\'brien\\tools" &&');
	});

	test("stays ASCII (legacy conhost code pages garble anything else)", () => {
		for (const channel of ["stable", "nightly"] as const) {
			const msg = windowsUpdateMessage(channel, "1.2.3", "D:\\tools");
			// One UTF-8 byte per char <=> every char is ASCII.
			expect(Buffer.byteLength(msg, "utf8")).toBe(msg.length);
		}
	});
});

describe("resolveWindowsPrefix", () => {
	const home = "C:\\Users\\u";

	test("omits the installer's own default (any casing / separator / trailing slash)", () => {
		expect(resolveWindowsPrefix("C:\\Users\\u\\.local", home)).toBeUndefined();
		expect(resolveWindowsPrefix("c:\\users\\U\\.LOCAL\\", home)).toBeUndefined();
		expect(resolveWindowsPrefix("C:/Users/u/.local", home)).toBeUndefined();
		expect(resolveWindowsPrefix(undefined, home)).toBeUndefined();
		expect(resolveWindowsPrefix("", home)).toBeUndefined();
	});

	test("keeps a custom prefix, including a UNC path", () => {
		expect(resolveWindowsPrefix("D:\\tools", home)).toBe("D:\\tools");
		expect(resolveWindowsPrefix("\\\\nas\\share\\thinkrail", home)).toBe(
			"\\\\nas\\share\\thinkrail",
		);
		// `&` is literal inside both `set "X=…"` and '…', so a legitimate path keeps working.
		expect(resolveWindowsPrefix("C:\\R&D\\tools", home)).toBe("C:\\R&D\\tools");
	});

	test("refuses a prefix that isn't rooted or can't be safely quoted", () => {
		for (const bad of [
			"tools\\thinkrail", // relative
			"/home/u/.local", // not a Windows root
			'D:\\a" && del /f /q C:\\Windows\\System32 && set "X=', // breaks out of cmd's quoting
			"D:\\%APPDATA%\\x", // cmd expands it before the installer sees it
			"D:\\a;C:\\b", // breaks the ;-delimited PATH value install.ps1 writes
			"D:\\a\nrm -rf /",
		]) {
			expect(() => resolveWindowsPrefix(bad, home)).toThrow("suspicious install prefix");
		}
	});
});
