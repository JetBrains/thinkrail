import { describe, expect, test } from "bun:test";
import { parseUpdateArgs, resolveUpdatePlan, windowsUpdateMessage } from "./update";

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

	test("stays ASCII (legacy conhost code pages garble anything else)", () => {
		for (const channel of ["stable", "nightly"] as const) {
			const msg = windowsUpdateMessage(channel, "1.2.3");
			// One UTF-8 byte per char <=> every char is ASCII.
			expect(Buffer.byteLength(msg, "utf8")).toBe(msg.length);
		}
	});
});
