import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	parseUninstallArgs,
	parseYesNo,
	RC_BLOCK_BEGIN,
	RC_BLOCK_END,
	resolveUninstallTargets,
	stripRcPathBlock,
} from "./uninstall";

describe("parseUninstallArgs", () => {
	test("defaults to asking about the data dir and confirming", () => {
		expect(parseUninstallArgs([])).toEqual({ yes: false, data: undefined, help: false });
	});

	test("reads the data choice and -y", () => {
		expect(parseUninstallArgs(["--remove-data"]).data).toBe("remove");
		expect(parseUninstallArgs(["--keep-data"]).data).toBe("keep");
		expect(parseUninstallArgs(["-y"]).yes).toBe(true);
		expect(parseUninstallArgs(["--yes", "--remove-data"])).toEqual({
			yes: true,
			data: "remove",
			help: false,
		});
		expect(parseUninstallArgs(["--help"]).help).toBe(true);
	});

	test("rejects a contradictory or unknown flag rather than guessing", () => {
		expect(() => parseUninstallArgs(["--keep-data", "--remove-data"])).toThrow(
			"mutually exclusive",
		);
		expect(() => parseUninstallArgs(["--purge"])).toThrow("Unknown option: --purge");
		expect(parseUninstallArgs(["--keep-data", "--keep-data"]).data).toBe("keep");
	});
});

describe("parseYesNo", () => {
	test("an empty or unrecognized answer keeps the offered default", () => {
		expect(parseYesNo("", false)).toBe(false);
		expect(parseYesNo("  ", true)).toBe(true);
		expect(parseYesNo("maybe", false)).toBe(false);
	});

	test("reads y/yes/n/no in any casing", () => {
		expect(parseYesNo("y", false)).toBe(true);
		expect(parseYesNo(" YES ", false)).toBe(true);
		expect(parseYesNo("N", true)).toBe(false);
		expect(parseYesNo("no", true)).toBe(false);
	});
});

describe("resolveUninstallTargets", () => {
	const base = {
		home: "/home/u",
		env: {} as Record<string, string | undefined>,
		execPath: "/usr/bin/bun",
		dataDir: "/home/u/.thinkrail",
		stagingRoot: "/home/u/.cache/thinkrail",
	};

	test("uses the recorded prefix, and the installers' default without one", () => {
		expect(
			resolveUninstallTargets({
				...base,
				platform: "linux",
				installMeta: { prefix: "/opt/tools" },
			}).binaries,
		).toEqual([join("/opt/tools", "bin", "thinkrail")]);
		expect(
			resolveUninstallTargets({ ...base, platform: "linux", installMeta: {} }).binaries,
		).toEqual([join("/home/u/.local", "bin", "thinkrail")]);
	});

	test("ignores a relative or non-string prefix instead of trusting it", () => {
		for (const prefix of ["relative/dir", "", 7, null]) {
			expect(
				resolveUninstallTargets({ ...base, platform: "linux", installMeta: { prefix } }).binDir,
			).toBe(join("/home/u/.local", "bin"));
		}
	});

	test("adds our own binary when we *are* one — the lost-install.json case", () => {
		expect(
			resolveUninstallTargets({ ...base, platform: "linux", installMeta: {} }).binaries,
		).not.toContain("/usr/bin/bun");
		const targets = resolveUninstallTargets({
			...base,
			platform: "linux",
			execPath: "/opt/elsewhere/bin/thinkrail",
			installMeta: {},
		});
		expect(targets.binaries).toEqual([
			join("/home/u/.local", "bin", "thinkrail"),
			"/opt/elsewhere/bin/thinkrail",
		]);
		expect(
			resolveUninstallTargets({
				...base,
				platform: "linux",
				execPath: join("/home/u/.local", "bin", "thinkrail"),
				installMeta: {},
			}).binaries,
		).toHaveLength(1);
	});

	test("Windows: the .exe name, a rooted recorded prefix, and no rc files", () => {
		const targets = resolveUninstallTargets({
			...base,
			platform: "win32",
			home: "C:\\Users\\u",
			execPath: "D:\\tools\\bin\\thinkrail.exe",
			installMeta: { prefix: "D:\\tools" },
		});
		expect(targets.binaries).toEqual([join("D:\\tools", "bin", "thinkrail.exe")]);
		expect(targets.rcFiles).toEqual([]);
		expect(targets.fishFile).toBe("");
	});

	test("the Windows PATH edit is licensed only by install.ps1's own ownership flag", () => {
		const owned = (installMeta: Record<string, unknown>) =>
			resolveUninstallTargets({
				...base,
				platform: "win32",
				home: "C:\\Users\\u",
				installMeta,
			}).pathEntryOwned;
		expect(owned({ prefix: "D:\\tools", path_entry_added: true })).toBe(true);
		expect(owned({ prefix: "D:\\tools", path_entry_added: false })).toBe(false);
		expect(owned({ prefix: "D:\\tools" })).toBe(false);
		expect(owned({})).toBe(false);
		expect(owned({ prefix: "relative\\dir", path_entry_added: true })).toBe(false);
		expect(owned({ path_entry_added: true })).toBe(false);
		expect(owned({ prefix: "D:\\tools", path_entry_added: "yes" })).toBe(false);
	});

	test("Unix never consults the flag — the rc block is its own proof", () => {
		expect(
			resolveUninstallTargets({
				...base,
				platform: "linux",
				installMeta: { prefix: "/opt/tools", path_entry_added: true },
			}).pathEntryOwned,
		).toBe(false);
	});

	test("scans every rc file install.sh could have written, plus $ZDOTDIR", () => {
		const targets = resolveUninstallTargets({
			...base,
			platform: "darwin",
			env: { ZDOTDIR: "/home/u/.config/zsh" },
			installMeta: {},
		});
		expect(targets.rcFiles).toEqual([
			"/home/u/.bashrc",
			"/home/u/.bash_profile",
			"/home/u/.profile",
			"/home/u/.zshrc",
			"/home/u/.config/zsh/.zshrc",
		]);
		expect(targets.fishFile).toBe("/home/u/.config/fish/conf.d/thinkrail.fish");
	});

	test("a $ZDOTDIR of $HOME doesn't double-list .zshrc", () => {
		const targets = resolveUninstallTargets({
			...base,
			platform: "linux",
			env: { ZDOTDIR: "/home/u" },
			installMeta: {},
		});
		expect(targets.rcFiles.filter((file) => file.endsWith(".zshrc"))).toEqual(["/home/u/.zshrc"]);
	});
});

describe("stripRcPathBlock", () => {
	const block = `${RC_BLOCK_BEGIN}\nexport PATH="$PATH:/home/u/.local/bin"\n${RC_BLOCK_END}`;

	test("removes the block install.sh appended, blank line included", () => {
		const before = `export EDITOR=vim\n\n${block}\n`;
		expect(stripRcPathBlock(before)).toEqual({
			next: "export EDITOR=vim\n",
			removed: true,
			unterminated: false,
		});
	});

	test("keeps everything around it, and only eats one blank line", () => {
		const before = `a=1\n\n\n${block}\nb=2\n`;
		expect(stripRcPathBlock(before).next).toBe("a=1\n\nb=2\n");
	});

	test("removes a repeated block (an older install left one behind)", () => {
		const result = stripRcPathBlock(`a=1\n${block}\nb=2\n${block}\n`);
		expect(result.next).toBe("a=1\nb=2\n");
		expect(result.removed).toBe(true);
	});

	test("a file without the block is left byte-for-byte alone", () => {
		const before = 'export PATH="$PATH:/home/u/.local/bin"\n';
		expect(stripRcPathBlock(before)).toEqual({
			next: before,
			removed: false,
			unterminated: false,
		});
	});

	test("refuses to rewrite a block with no end marker instead of truncating the file", () => {
		const before = `a=1\n${RC_BLOCK_BEGIN}\nexport PATH="$PATH:/x"\nb=2\n`;
		expect(stripRcPathBlock(before)).toEqual({
			next: before,
			removed: false,
			unterminated: true,
		});
	});
});
