import { describe, expect, test } from "bun:test";
import {
	createCliHostUpdate as createCliHostUpdateImpl,
	discoverReleaseVersion,
	parseUpdateArgs,
	type ReleaseFetch,
	resolveUpdatePlan,
	resolveWindowsInstallPrefix,
	resolveWindowsPrefix,
	resolveWindowsUpdatePlan,
	windowsManualUpdateMessage,
} from "./update";

const RELEASE_ERROR_RE = /^Unable to check for ThinkRail updates\.$/;

function githubJson(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function createCliHostUpdate(
	build: string,
	baked: string,
	installedVersion: string,
	fetchImpl?: ReleaseFetch,
	childRunner?: Parameters<typeof createCliHostUpdateImpl>[5],
) {
	return createCliHostUpdateImpl(
		build,
		baked,
		installedVersion,
		{ platform: "linux", execPath: "/opt/thinkrail/bin/thinkrail" },
		fetchImpl,
		childRunner,
	);
}

describe("discoverReleaseVersion", () => {
	test("stable reads releases/latest and returns the unprefixed candidate", async () => {
		let requestedUrl = "";
		let requestSignal: AbortSignal | null | undefined;
		const candidate = await discoverReleaseVersion("stable", async (input, init) => {
			requestedUrl = String(input);
			requestSignal = init?.signal;
			return githubJson({ tag_name: "v1.2.3" });
		});

		expect(requestedUrl).toBe("https://api.github.com/repos/JetBrains/thinkrail/releases/latest");
		expect(requestSignal).toBeInstanceOf(AbortSignal);
		expect(candidate).toBe("1.2.3");
	});

	test("nightly reads the bounded listing and returns the first exact nightly tag", async () => {
		let requestedUrl = "";
		const candidate = await discoverReleaseVersion("nightly", async (input) => {
			requestedUrl = String(input);
			return githubJson([
				{ tag_name: "v2.0.0" },
				{ tag_name: "v2.0.0-nightly.9-extra" },
				{ tag_name: "v1.4.0-nightly.17" },
				{ tag_name: "v1.4.0-nightly.16" },
			]);
		});

		expect(requestedUrl).toBe(
			"https://api.github.com/repos/JetBrains/thinkrail/releases?per_page=20",
		);
		expect(candidate).toBe("1.4.0-nightly.17");
	});

	test("closes network, HTTP, and malformed-response errors", async () => {
		await expect(
			discoverReleaseVersion("stable", async () => {
				throw new Error("private network diagnostic");
			}),
		).rejects.toThrow(RELEASE_ERROR_RE);
		await expect(
			discoverReleaseVersion(
				"stable",
				async () => new Response("private response diagnostic", { status: 503 }),
			),
		).rejects.toThrow(RELEASE_ERROR_RE);
		await expect(
			discoverReleaseVersion("stable", async () => new Response("not json", { status: 200 })),
		).rejects.toThrow(RELEASE_ERROR_RE);
		await expect(
			discoverReleaseVersion("stable", async () => githubJson({ tag_name: "v1.2.3-rc.1" })),
		).rejects.toThrow(RELEASE_ERROR_RE);
		await expect(
			discoverReleaseVersion("nightly", async () =>
				githubJson([{ tag_name: "v1.2.3" }, { tag_name: "nightly.12" }]),
			),
		).rejects.toThrow(RELEASE_ERROR_RE);
	});

	test("aborts a request at its deadline without leaking its diagnostic", async () => {
		let aborted = false;
		const waitingFetch: ReleaseFetch = (_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				if (!signal) {
					reject(new Error("missing signal"));
					return;
				}
				signal.addEventListener(
					"abort",
					() => {
						aborted = true;
						reject(new Error("private abort diagnostic"));
					},
					{ once: true },
				);
			});

		await expect(discoverReleaseVersion("stable", waitingFetch, 5)).rejects.toThrow(
			RELEASE_ERROR_RE,
		);
		expect(aborted).toBe(true);
	});
});

describe("createCliHostUpdate", () => {
	test("creates the minimal six-hour source and returns a newer stable notice", async () => {
		let requests = 0;
		const fetchImpl: ReleaseFetch = async () => {
			requests += 1;
			return githubJson({ tag_name: "v1.2.4" });
		};
		const updates = createCliHostUpdate("binary", "stable", "1.2.3", fetchImpl);
		if (!updates) throw new Error("expected host updates");

		expect(Object.keys(updates).sort()).toEqual(["check", "intervalMs", "run"]);
		expect(updates.intervalMs).toBe(6 * 60 * 60 * 1000);
		expect(requests).toBe(0);
		expect(await updates.check()).toEqual({
			currentVersion: "1.2.3",
			availableVersion: "1.2.4",
			channel: "stable",
		});
		expect(requests).toBe(1);
	});

	test("runs this installed executable's parameterless update child asynchronously", async () => {
		let command: readonly string[] | undefined;
		let finish!: (exitCode: number) => void;
		const exited = new Promise<number>((resolve) => {
			finish = resolve;
		});
		const updates = createCliHostUpdate(
			"binary",
			"stable",
			"1.2.3",
			async () => githubJson({ tag_name: "v1.2.4" }),
			async (nextCommand) => {
				command = nextCommand;
				return await exited;
			},
		);
		if (!updates) throw new Error("expected host updates");

		let settled = false;
		const running = updates.run().then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(command).toEqual(["/opt/thinkrail/bin/thinkrail", "update"]);
		expect(settled).toBe(false);

		finish(0);
		await running;
		expect(settled).toBe(true);
	});

	test("closes child launch and nonzero-exit diagnostics", async () => {
		const create = (runner: () => Promise<number>) =>
			createCliHostUpdate(
				"binary",
				"nightly",
				"1.2.3-nightly.1",
				async () => githubJson([{ tag_name: "v1.2.3-nightly.2" }]),
				runner,
			);
		const nonzero = create(async () => 23);
		const launchFailure = create(async () => {
			throw new Error("private child launch diagnostic");
		});
		if (!nonzero || !launchFailure) throw new Error("expected host updates");

		await expect(nonzero.run()).rejects.toThrow(/^Unable to update ThinkRail\.$/);
		await expect(launchFailure.run()).rejects.toThrow(/^Unable to update ThinkRail\.$/);
	});

	test("returns a notice only for a strictly newer same-channel version", async () => {
		const stable = (currentVersion: string, availableVersion: string) =>
			createCliHostUpdate("binary", "stable", currentVersion, async () =>
				githubJson({ tag_name: `v${availableVersion}` }),
			);
		const nightly = (currentVersion: string, availableVersion: string) =>
			createCliHostUpdate("binary", "nightly", currentVersion, async () =>
				githubJson([{ tag_name: `v${availableVersion}` }]),
			);

		expect(await stable("1.2.3", "1.2.3")?.check()).toBeNull();
		expect(await stable("1.2.3", "1.2.2")?.check()).toBeNull();
		expect(await stable("1.2.3", "01.2.4")?.check()).toBeNull();
		expect(await stable("invalid", "2.0.0")?.check()).toBeNull();
		expect(await nightly("1.2.3-nightly.9", "1.2.3-nightly.10")?.check()).toEqual({
			currentVersion: "1.2.3-nightly.9",
			availableVersion: "1.2.3-nightly.10",
			channel: "nightly",
		});
		expect(await nightly("1.3.0-nightly.1", "1.2.9-nightly.99")?.check()).toBeNull();
	});

	test("keeps discovery failures closed for the host", async () => {
		const updates = createCliHostUpdate("binary", "stable", "1.2.3", async () => {
			throw new Error("private network diagnostic");
		});
		if (!updates) throw new Error("expected host updates");

		await expect(updates.check()).rejects.toThrow(RELEASE_ERROR_RE);
	});

	test("disables discovery for source, desktop, dev, unsupported channels, and unsafe layouts", () => {
		expect(createCliHostUpdate("source", "stable", "1.2.3")).toBeUndefined();
		expect(createCliHostUpdate("desktop", "stable", "1.2.3")).toBeUndefined();
		expect(createCliHostUpdate("binary", "dev", "0.0.0-dev")).toBeUndefined();
		expect(createCliHostUpdate("binary", "beta", "1.2.3-beta.1")).toBeUndefined();
		expect(createCliHostUpdate("binary", "nightly", "1.2.3-nightly.1")).toBeDefined();
		for (const runtime of [
			{ platform: "linux", execPath: "/downloads/thinkrail-linux-x64" },
			{ platform: "linux", execPath: "/opt/unsafe;prefix/bin/thinkrail" },
			{
				platform: "win32",
				execPath: "C:\\Downloads\\thinkrail-windows-x64.exe",
			},
			{ platform: "win32", execPath: "C:\\unsafe%prefix\\bin\\thinkrail.exe" },
		]) {
			expect(createCliHostUpdateImpl("binary", "stable", "1.2.3", runtime)).toBeUndefined();
		}
	});
});

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
	const sourceRuntime = { build: "source", platform: "linux", execPath: "/usr/bin/bun" };

	test("flag channel wins over metadata and baked", () => {
		const plan = resolveUpdatePlan({
			...sourceRuntime,
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
				...sourceRuntime,
				args: { version: "latest" },
				installMeta: { channel: "nightly" },
				baked: "stable",
				home,
			}).channel,
		).toBe("nightly");
		expect(
			resolveUpdatePlan({
				...sourceRuntime,
				args: { version: "latest" },
				installMeta: {},
				baked: "nightly",
				home,
			}).channel,
		).toBe("nightly");
		const dev = resolveUpdatePlan({
			...sourceRuntime,
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
			...sourceRuntime,
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
				...sourceRuntime,
				args: { version: "latest" },
				installMeta: { prefix: "/tmp/$(rm -rf ~)" },
				baked: "stable",
				home,
			}),
		).toThrow("suspicious install prefix");
		expect(() =>
			resolveUpdatePlan({
				...sourceRuntime,
				args: { version: "latest" },
				installMeta: { prefix: "relative/dir" },
				baked: "stable",
				home,
			}),
		).toThrow("suspicious install prefix");
	});

	test("the running bin layout is authoritative over stale or missing metadata", () => {
		const runtime = {
			build: "binary",
			platform: "linux",
			execPath: "/opt/current/bin/thinkrail",
		};
		const stale = resolveUpdatePlan({
			...runtime,
			args: { version: "latest" },
			installMeta: { prefix: "/opt/other", channel: "nightly" },
			baked: "stable",
			home,
		});
		expect(stale.prefix).toBe("/opt/current");
		expect(stale.channel).toBe("stable");

		const missing = resolveUpdatePlan({
			...runtime,
			args: { version: "latest" },
			installMeta: {},
			baked: "nightly",
			home,
		});
		expect(missing.prefix).toBe("/opt/current");
		expect(missing.channel).toBe("nightly");
	});

	test("trusts a matching metadata channel, while an explicit channel still wins", () => {
		const runtime = {
			build: "binary",
			platform: "darwin",
			execPath: "/opt/current/bin/thinkrail",
		};
		expect(
			resolveUpdatePlan({
				...runtime,
				args: { version: "latest" },
				installMeta: { prefix: "/opt/current/./", channel: "nightly" },
				baked: "stable",
				home,
			}).channel,
		).toBe("nightly");
		expect(
			resolveUpdatePlan({
				...runtime,
				args: { channel: "stable", version: "latest" },
				installMeta: { prefix: "/opt/current", channel: "nightly" },
				baked: "nightly",
				home,
			}).channel,
		).toBe("stable");
	});

	test.each([
		["/opt/manual/thinkrail", { prefix: "/home/u/.local", channel: "nightly" }],
		["/downloads/thinkrail-linux-x64", {}],
		["/opt/unsafe;prefix/bin/thinkrail", {}],
	])("fails closed for the manual binary %s", (execPath, installMeta) => {
		expect(() =>
			resolveUpdatePlan({
				build: "binary",
				platform: "linux",
				execPath,
				args: { version: "latest" },
				installMeta,
				baked: "stable",
				home,
			}),
		).toThrow("outside the supported <prefix>/bin layout");
	});

	test("rejects a pinned version from the other channel after resolution", () => {
		expect(() =>
			resolveUpdatePlan({
				...sourceRuntime,
				args: { version: "1.2.3-nightly.4" },
				installMeta: {},
				baked: "stable",
				home,
			}),
		).toThrow("does not belong to the stable channel");
		expect(() =>
			resolveUpdatePlan({
				...sourceRuntime,
				args: { version: "1.2.3" },
				installMeta: { channel: "nightly" },
				baked: "stable",
				home,
			}),
		).toThrow("does not belong to the nightly channel");
	});
});

describe("resolveWindowsUpdatePlan", () => {
	const home = "C:\\Users\\u";
	const sourceRuntime = {
		build: "source",
		platform: "win32",
		execPath: "C:\\bun\\bun.exe",
	};

	test("passes channel, version and prefix to install.ps1 — always all three", () => {
		const plan = resolveWindowsUpdatePlan({
			...sourceRuntime,
			args: { version: "latest" },
			installMeta: { channel: "nightly", prefix: "D:\\tools" },
			baked: "stable",
			home,
		});
		expect(plan.channel).toBe("nightly");
		expect(plan.prefix).toBe("D:/tools");
		expect(plan.psArgs).toEqual([
			"-Channel",
			"nightly",
			"-Version",
			"latest",
			"-Prefix",
			"D:/tools",
		]);
		expect(plan.manualPrefix).toBe("D:/tools");
	});

	test("resolves the channel exactly like the Unix plan, and defaults the prefix", () => {
		const plan = resolveWindowsUpdatePlan({
			...sourceRuntime,
			args: { channel: "stable", version: "0.3.0" },
			installMeta: { channel: "nightly" },
			baked: "nightly",
			home,
		});
		expect(plan.channel).toBe("stable");
		expect(plan.psArgs).toEqual([
			"-Channel",
			"stable",
			"-Version",
			"0.3.0",
			"-Prefix",
			"C:/Users/u/.local",
		]);
		expect(plan.manualPrefix).toBeUndefined();
	});

	test("refuses to install anywhere a tampered install.json points", () => {
		expect(() =>
			resolveWindowsUpdatePlan({
				...sourceRuntime,
				args: { version: "latest" },
				installMeta: { prefix: 'D:\\a" && del /f /q C:\\Windows\\System32 && set "X=' },
				baked: "stable",
				home,
			}),
		).toThrow("suspicious install prefix");
	});

	test("targets a mixed-case running Windows bin layout and ignores stale metadata", () => {
		const plan = resolveWindowsUpdatePlan({
			build: "binary",
			platform: "win32",
			execPath: "D:\\current\\bin\\ThinkRail.exe",
			args: { version: "latest" },
			installMeta: { prefix: "C:\\other", channel: "nightly" },
			baked: "stable",
			home,
		});
		expect(plan.prefix).toBe("D:/current");
		expect(plan.channel).toBe("stable");
		expect(plan.manualPrefix).toBe("D:/current");
		const missing = resolveWindowsUpdatePlan({
			build: "binary",
			platform: "win32",
			execPath: "D:\\current\\bin\\thinkrail.exe",
			args: { version: "latest" },
			installMeta: {},
			baked: "nightly",
			home,
		});
		expect(missing.prefix).toBe("D:/current");
		expect(missing.channel).toBe("nightly");
	});

	test.each([
		"/d/current",
		"/cygdrive/d/current",
	])("trusts matching legacy Git Bash metadata prefix %s", (prefix) => {
		const plan = resolveWindowsUpdatePlan({
			build: "binary",
			platform: "win32",
			execPath: "D:\\current\\bin\\thinkrail.exe",
			args: { version: "latest" },
			installMeta: { prefix, channel: "nightly" },
			baked: "stable",
			home,
		});
		expect(plan.prefix).toBe("D:/current");
		expect(plan.channel).toBe("nightly");
	});

	test("normalizes and trusts a slash-form UNC prefix", () => {
		const plan = resolveWindowsUpdatePlan({
			build: "binary",
			platform: "win32",
			execPath: "\\\\nas\\share\\thinkrail\\bin\\thinkrail.exe",
			args: { version: "latest" },
			installMeta: { prefix: "//nas/share/thinkrail", channel: "nightly" },
			baked: "stable",
			home,
		});
		expect(plan.prefix).toBe("//nas/share/thinkrail");
		expect(plan.channel).toBe("nightly");
	});

	test.each([
		["D:\\manual\\ThinkRail.exe", {}],
		[
			"D:\\Downloads\\thinkrail-windows-x64.exe",
			{ prefix: "C:\\Users\\u\\.local", channel: "nightly" },
		],
		["D:\\unsafe%prefix\\bin\\thinkrail.exe", {}],
	])("fails closed for the manual Windows binary %s", (execPath, installMeta) => {
		expect(() =>
			resolveWindowsUpdatePlan({
				build: "binary",
				platform: "win32",
				execPath,
				args: { version: "latest" },
				installMeta,
				baked: "stable",
				home,
			}),
		).toThrow("outside the supported <prefix>/bin layout");
	});
});

describe("resolveWindowsInstallPrefix", () => {
	const home = "C:\\Users\\u";

	test("falls back to the installer's own default", () => {
		expect(resolveWindowsInstallPrefix(undefined, home)).toBe("C:/Users/u/.local");
		expect(resolveWindowsInstallPrefix("", home)).toBe("C:/Users/u/.local");
		expect(resolveWindowsInstallPrefix(42, home)).toBe("C:/Users/u/.local");
	});

	test("keeps a recorded prefix, refuses an unusable one", () => {
		expect(resolveWindowsInstallPrefix("D:\\tools", home)).toBe("D:/tools");
		expect(() => resolveWindowsInstallPrefix("relative\\dir", home)).toThrow(
			"suspicious install prefix",
		);
	});
});

describe("windowsManualUpdateMessage", () => {
	const psLine = (msg: string) => msg.split("\n").find((l) => l.includes("PowerShell:")) ?? "";
	const cmdLine = (msg: string) => msg.split("\n").find((l) => l.includes("cmd:")) ?? "";

	test("stable/latest is one bare command per shell", () => {
		const msg = windowsManualUpdateMessage("stable", "latest");
		expect(psLine(msg)).toContain(
			"irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex",
		);
		expect(cmdLine(msg)).toContain('powershell -c "irm ');
		expect(msg).not.toContain("THINKRAIL_CHANNEL");
		expect(msg).not.toContain("THINKRAIL_VERSION");
	});

	test("carries the channel in each shell's own env syntax", () => {
		const msg = windowsManualUpdateMessage("nightly", "latest");
		expect(psLine(msg)).toContain("$env:THINKRAIL_CHANNEL='nightly';");
		expect(psLine(msg)).not.toContain('set "');
		expect(cmdLine(msg)).toContain('set "THINKRAIL_CHANNEL=nightly" &&');
		expect(cmdLine(msg)).not.toContain("$env:");
	});

	test("carries a pinned version too", () => {
		const msg = windowsManualUpdateMessage("nightly", "0.2.0");
		expect(psLine(msg)).toContain(
			"$env:THINKRAIL_CHANNEL='nightly'; $env:THINKRAIL_VERSION='0.2.0';",
		);
		expect(cmdLine(msg)).toContain(
			'set "THINKRAIL_CHANNEL=nightly" && set "THINKRAIL_VERSION=0.2.0" &&',
		);
	});

	test("carries a custom prefix, so the re-install lands where this one did", () => {
		const msg = windowsManualUpdateMessage("stable", "latest", "D:\\tools");
		expect(psLine(msg)).toContain("$env:THINKRAIL_PREFIX='D:\\tools';");
		expect(cmdLine(msg)).toContain('set "THINKRAIL_PREFIX=D:\\tools" &&');
	});

	test("escapes a quote-bearing prefix for PowerShell", () => {
		const msg = windowsManualUpdateMessage("stable", "latest", "D:\\o'brien\\tools");
		expect(psLine(msg)).toContain("$env:THINKRAIL_PREFIX='D:\\o''brien\\tools';");
		expect(cmdLine(msg)).toContain('set "THINKRAIL_PREFIX=D:\\o\'brien\\tools" &&');
	});

	test("stays ASCII (legacy conhost code pages garble anything else)", () => {
		for (const channel of ["stable", "nightly"] as const) {
			const msg = windowsManualUpdateMessage(channel, "1.2.3", "D:\\tools");
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
		expect(resolveWindowsPrefix("D:\\tools", home)).toBe("D:/tools");
		expect(resolveWindowsPrefix("\\\\nas\\share\\thinkrail", home)).toBe("//nas/share/thinkrail");
		expect(resolveWindowsPrefix("C:\\R&D\\tools", home)).toBe("C:/R&D/tools");
	});

	test("refuses a prefix that isn't rooted or can't be safely quoted", () => {
		for (const bad of [
			"tools\\thinkrail",
			"/home/u/.local",
			'D:\\a" && del /f /q C:\\Windows\\System32 && set "X=',
			"D:\\%APPDATA%\\x",
			"D:\\a;C:\\b",
			"D:\\a\nrm -rf /",
		]) {
			expect(() => resolveWindowsPrefix(bad, home)).toThrow("suspicious install prefix");
		}
	});
});
