import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	desktopAppUserModelId,
	loadWindowsShellApi,
	stampTaskbarShortcuts,
	taskbarShortcutCandidates,
	type WindowsShortcut,
} from "./windowsTaskbarIdentity";

test("names one AppUserModelID per channel", () => {
	expect(desktopAppUserModelId("stable")).toBe("JetBrains.ThinkRail");
	expect(desktopAppUserModelId("nightly")).toBe("JetBrains.ThinkRail.Nightly");
	expect(desktopAppUserModelId("dev")).toBe("JetBrains.ThinkRail.Dev");
	expect(() => desktopAppUserModelId("beta")).toThrow('unknown release channel "beta"');
});

function withTemp(run: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-taskbar-"));
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("collects Electrobun's recorded shortcuts and the taskbar pins", () => {
	withTemp((root) => {
		const appDir = join(root, "local", "ai.thinkrail.app", "canary", "app");
		mkdirSync(appDir, { recursive: true });
		writeFileSync(
			join(root, "local", "ai.thinkrail.app", "canary", ".electrobun-uninstall.json"),
			JSON.stringify({
				schema_version: 1,
				desktop_shortcut: "C:\\Users\\me\\Desktop\\ThinkRail (Canary).lnk",
				start_menu_shortcut: "C:\\Users\\me\\Start Menu\\Programs\\ThinkRail (Canary).lnk",
			}),
		);
		const appData = join(root, "roaming");
		const pinned = join(
			appData,
			"Microsoft",
			"Internet Explorer",
			"Quick Launch",
			"User Pinned",
			"TaskBar",
		);
		mkdirSync(pinned, { recursive: true });
		writeFileSync(join(pinned, "ThinkRail (Canary).lnk"), "");
		writeFileSync(join(pinned, "desktop.ini"), "");

		expect(taskbarShortcutCandidates(appDir, appData)).toEqual([
			"C:\\Users\\me\\Start Menu\\Programs\\ThinkRail (Canary).lnk",
			"C:\\Users\\me\\Desktop\\ThinkRail (Canary).lnk",
			join(pinned, "ThinkRail (Canary).lnk"),
		]);
	});
});

test("finds nothing for an unmanaged build or an unknown manifest schema", () => {
	withTemp((root) => {
		const appDir = join(root, "build", "ThinkRail-dev");
		mkdirSync(appDir, { recursive: true });
		expect(taskbarShortcutCandidates(appDir, undefined)).toEqual([]);
		writeFileSync(
			join(root, "build", ".electrobun-uninstall.json"),
			JSON.stringify({ schema_version: 2, desktop_shortcut: "C:\\x.lnk" }),
		);
		expect(taskbarShortcutCandidates(appDir, join(root, "missing"))).toEqual([]);
	});
});

test("stamps only existing shortcuts to this launcher that carry another ID", () => {
	withTemp((root) => {
		const file = (name: string) => {
			const path = join(root, `${name}.lnk`);
			writeFileSync(path, "");
			return path;
		};
		const ours = file("ours");
		const current = file("current");
		const other = file("other");
		const broken = file("broken");
		const launcher =
			"C:\\Users\\me\\AppData\\Local\\ai.thinkrail.app\\stable\\app\\bin\\launcher.exe";
		const ids = new Map<string, string | null>([
			[ours, null],
			[current, "JetBrains.ThinkRail"],
			[other, null],
		]);
		const closed: string[] = [];
		const open = (path: string): WindowsShortcut => {
			if (path === broken) throw new Error("not a shortcut");
			return {
				target: () => (path === other ? "C:\\Tools\\other.exe" : launcher.toUpperCase()),
				appUserModelId: () => ids.get(path) ?? null,
				setAppUserModelId: (id) => ids.set(path, id),
				close: () => closed.push(path),
			};
		};

		const result = stampTaskbarShortcuts(
			[ours, current, other, broken, join(root, "missing.lnk")],
			launcher,
			"JetBrains.ThinkRail",
			open,
		);

		expect(result.stamped).toEqual([ours]);
		expect(result.failures).toEqual([new Error("not a shortcut")]);
		expect(ids.get(ours)).toBe("JetBrains.ThinkRail");
		expect(ids.get(other)).toBeNull();
		expect(closed).toEqual([ours, current, other]);
	});
});

function powershell(script: string): string {
	const result = Bun.spawnSync(
		["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	if (!result.success) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

test.skipIf(process.platform !== "win32")("sets the process AppUserModelID", () => {
	const shell = loadWindowsShellApi();
	expect(loadWindowsShellApi()).toBe(shell);
	shell.setProcessAppUserModelId("JetBrains.ThinkRail.Test");
	expect(shell.processAppUserModelId()).toBe("JetBrains.ThinkRail.Test");
});

test.skipIf(process.platform !== "win32")(
	"stamps a real shortcut that targets the launcher",
	() => {
		withTemp((root) => {
			const launcher = join(root, "app", "bin", "launcher.exe");
			const other = join(root, "other.exe");
			mkdirSync(join(root, "app", "bin"), { recursive: true });
			writeFileSync(launcher, "");
			writeFileSync(other, "");
			const ours = join(root, "ThinkRail.lnk");
			const foreign = join(root, "Other.lnk");
			for (const [path, target] of [
				[ours, launcher],
				[foreign, other],
			]) {
				powershell(
					`$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${path}'); $s.TargetPath = '${target}'; $s.Save()`,
				);
			}
			const shell = loadWindowsShellApi();
			const id = "JetBrains.ThinkRail.Test";
			const opened = shell.openShortcut(ours);
			try {
				expect(realpathSync.native(opened.target() ?? "")).toBe(realpathSync.native(launcher));
				expect(opened.appUserModelId()).toBeNull();
			} finally {
				opened.close();
			}

			expect(stampTaskbarShortcuts([ours, foreign], launcher, id, shell.openShortcut)).toEqual({
				stamped: [ours],
				failures: [],
			});
			expect(
				stampTaskbarShortcuts([ours, foreign], launcher, id, shell.openShortcut).stamped,
			).toEqual([]);
			const readId = (path: string) =>
				powershell(
					`(New-Object -ComObject Shell.Application).NameSpace('${root}').ParseName('${path.slice(root.length + 1)}').ExtendedProperty('System.AppUserModel.ID')`,
				);
			expect(readId(ours)).toBe(id);
			expect(readId(foreign)).toBe("");
			const reopened = shell.openShortcut(ours);
			try {
				expect(reopened.appUserModelId()).toBe(id);
			} finally {
				reopened.close();
			}
		});
	},
);
