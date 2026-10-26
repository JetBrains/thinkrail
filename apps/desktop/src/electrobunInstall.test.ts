import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readElectrobunInstall } from "./electrobunInstall";

function withChannelRoot(run: (channelRoot: string, appDir: string) => void): void {
	const channelRoot = mkdtempSync(join(tmpdir(), "thinkrail-install-"));
	const appDir = join(channelRoot, "app");
	mkdirSync(appDir);
	try {
		run(channelRoot, appDir);
	} finally {
		rmSync(channelRoot, { recursive: true, force: true });
	}
}

test("reads the install identity and Start-menu shortcut Electrobun records", () => {
	withChannelRoot((channelRoot, appDir) => {
		writeFileSync(
			join(channelRoot, ".electrobun-uninstall.json"),
			JSON.stringify({
				schema_version: 1,
				identifier: "ai.thinkrail.app",
				channel: "canary",
				desktop_shortcut: "C:\\Users\\me\\Desktop\\ThinkRail (Canary).lnk",
				start_menu_shortcut: "C:\\Users\\me\\Start Menu\\Programs\\ThinkRail (Canary).lnk",
			}),
		);
		expect(readElectrobunInstall(appDir)).toEqual({
			identifier: "ai.thinkrail.app",
			channel: "canary",
			startMenuShortcut: "C:\\Users\\me\\Start Menu\\Programs\\ThinkRail (Canary).lnk",
		});
	});
});

test("ignores a missing record and a schema it does not know", () => {
	withChannelRoot((channelRoot, appDir) => {
		expect(readElectrobunInstall(appDir)).toBeNull();
		writeFileSync(
			join(channelRoot, ".electrobun-uninstall.json"),
			JSON.stringify({ schema_version: 2, identifier: "ai.thinkrail.app", channel: "canary" }),
		);
		expect(readElectrobunInstall(appDir)).toBeNull();
	});
});

test("throws on a corrupt record so the caller can report it", () => {
	withChannelRoot((channelRoot, appDir) => {
		writeFileSync(join(channelRoot, ".electrobun-uninstall.json"), "");
		expect(() => readElectrobunInstall(appDir)).toThrow(SyntaxError);
	});
});
