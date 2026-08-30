import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateWindowsSetupExecutable, windowsSetupExecutableSuffix } from "./artifact";

const roots: string[] = [];

function packageDir(...files: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-artifact-test-"));
	roots.push(root);
	for (const file of files) {
		const path = join(root, file);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, "");
	}
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("names the Windows setup executable per channel", () => {
	expect(windowsSetupExecutableSuffix("stable")).toBe("-Setup.exe");
	expect(windowsSetupExecutableSuffix("canary")).toBe("-Setup-canary.exe");
});

test("locates the channel-suffixed setup executable inside an expanded ZIP", () => {
	const root = packageDir(
		"ThinkRail-Setup-canary.exe",
		join(".installer", "ThinkRail-Setup-canary.tar.zst"),
	);
	expect(locateWindowsSetupExecutable(root, "canary")).toBe(
		join(root, "ThinkRail-Setup-canary.exe"),
	);
});

test("locates the unsuffixed setup executable for the stable channel", () => {
	const root = packageDir("ThinkRail-Setup.exe");
	expect(locateWindowsSetupExecutable(root, "stable")).toBe(join(root, "ThinkRail-Setup.exe"));
});

test("refuses a ZIP whose setup executable belongs to another channel", () => {
	const root = packageDir("ThinkRail-Setup-canary.exe");
	expect(() => locateWindowsSetupExecutable(root, "stable")).toThrow(
		"desktop ZIP does not contain an installer matching *-Setup.exe",
	);
});
