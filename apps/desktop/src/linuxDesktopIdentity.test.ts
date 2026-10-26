import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	desktopEntryId,
	LINUX_DESKTOP_CATEGORIES,
	linuxNotificationCommand,
	withDesktopCategories,
} from "./linuxDesktopIdentity";

const identity = {
	iconPath: "/opt/thinkrail/Resources/appIcon.png",
	desktopEntry: "ThinkRail-canary",
};

test("names ThinkRail, its icon and its desktop entry as the notification sender", () => {
	expect(
		linuxNotificationCommand(
			{ title: "ThinkRail", subtitle: "main", body: "Agent finished" },
			identity,
		),
	).toEqual([
		"notify-send",
		"--app-name=ThinkRail",
		"--icon=/opt/thinkrail/Resources/appIcon.png",
		"--hint=string:desktop-entry:ThinkRail-canary",
		"--",
		"ThinkRail",
		"main\nAgent finished",
	]);
});

test("keeps a leading dash in the text out of the option parser and quiets silent notifications", () => {
	expect(
		linuxNotificationCommand(
			{ title: "--help", body: "", silent: true },
			{ ...identity, desktopEntry: null },
		),
	).toEqual([
		"notify-send",
		"--app-name=ThinkRail",
		"--icon=/opt/thinkrail/Resources/appIcon.png",
		"--urgency=low",
		"--",
		"--help",
	]);
});

test("finds the bundle's desktop entry id", () => {
	const appDir = mkdtempSync(join(tmpdir(), "thinkrail-desktop-entry-"));
	try {
		expect(desktopEntryId(appDir)).toBeNull();
		writeFileSync(join(appDir, "ThinkRail-canary.desktop"), "");
		expect(desktopEntryId(appDir)).toBe("ThinkRail-canary");
	} finally {
		rmSync(appDir, { recursive: true, force: true });
	}
});

test("files the menu entry under Development and IDE", () => {
	const template =
		"[Desktop Entry]\nVersion=1.0\nType=Application\nName=ThinkRail\nCategories=Utility;\n";
	expect(withDesktopCategories(template, LINUX_DESKTOP_CATEGORIES)).toBe(
		"[Desktop Entry]\nVersion=1.0\nType=Application\nName=ThinkRail\nCategories=Development;IDE;\n",
	);
	expect(withDesktopCategories("[Desktop Entry]\nName=ThinkRail\n", LINUX_DESKTOP_CATEGORIES)).toBe(
		"[Desktop Entry]\nCategories=Development;IDE;\nName=ThinkRail\n",
	);
});
