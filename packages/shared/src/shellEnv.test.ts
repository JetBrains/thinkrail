import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localeRepair, pathLooksComplete, resolveShellEnv } from "./shellEnv";

const LOCALE_VARS = ["LANG", "LC_ALL", "LC_CTYPE"];
const LAUNCHD_DEFAULT_PATH = "/Users/x/.pi/agent/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin";

let originalPath: string | undefined;
let originalShell: string | undefined;
let originalLocale: Record<string, string | undefined> = {};
beforeEach(() => {
	originalPath = process.env.PATH;
	originalShell = process.env.SHELL;
	originalLocale = Object.fromEntries(LOCALE_VARS.map((key) => [key, process.env[key]]));
});
afterEach(() => {
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
	if (originalShell === undefined) delete process.env.SHELL;
	else process.env.SHELL = originalShell;
	for (const key of LOCALE_VARS) {
		const value = originalLocale[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test("pathLooksComplete detects user dirs", () => {
	expect(pathLooksComplete("/opt/homebrew/bin:/usr/bin")).toBe(true);
	expect(pathLooksComplete("/Users/x/.bun/bin:/usr/bin")).toBe(true);
	expect(pathLooksComplete("/Users/x/.nvm/versions/node/v22/bin:/usr/bin")).toBe(true);
	expect(pathLooksComplete("/usr/bin:/bin")).toBe(false);
});

test("pathLooksComplete rejects the macOS launchd default PATH", () => {
	expect(pathLooksComplete(LAUNCHD_DEFAULT_PATH)).toBe(false);
});

test("resolveShellEnv adopts the login shell PATH when only the launchd default is present", () => {
	const dir = mkdtempSync(join(tmpdir(), "shellenv-"));
	try {
		const fakeShell = join(dir, "shell");
		writeFileSync(
			fakeShell,
			"#!/bin/sh\nprintf 'HOME=/Users/x\\0PATH=/opt/homebrew/bin:/usr/bin\\0'\n",
		);
		chmodSync(fakeShell, 0o755);
		process.env.SHELL = fakeShell;
		process.env.PATH = LAUNCHD_DEFAULT_PATH;

		resolveShellEnv();

		expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveShellEnv leaves PATH alone when it already looks complete", () => {
	process.env.PATH = "/opt/homebrew/bin:/usr/bin";
	resolveShellEnv();
	expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
});

test("localeRepair supplies a UTF-8 locale only when none is configured", () => {
	expect(localeRepair({}, "linux")).toBe("C.UTF-8");
	expect(localeRepair({}, "darwin")).toBe("en_US.UTF-8");

	expect(localeRepair({ LANG: "en_GB.UTF-8" }, "linux")).toBeNull();
	expect(localeRepair({ LANG: "C" }, "linux")).toBeNull();
	expect(localeRepair({ LC_ALL: "de_DE.UTF-8" }, "linux")).toBeNull();
	expect(localeRepair({ LC_CTYPE: "ru_RU.UTF-8" }, "linux")).toBeNull();
});

test("resolveShellEnv installs LANG when the host has no locale at all", () => {
	for (const key of LOCALE_VARS) delete process.env[key];
	process.env.PATH = "/opt/homebrew/bin:/usr/bin";

	resolveShellEnv();

	expect(process.env.LANG).toMatch(/UTF-8$/);
	expect(process.env.LC_ALL).toBeUndefined();
	expect(process.env.LC_CTYPE).toBeUndefined();
});

test("resolveShellEnv leaves an existing locale untouched", () => {
	process.env.LANG = "ru_RU.UTF-8";
	process.env.PATH = "/opt/homebrew/bin:/usr/bin";

	resolveShellEnv();

	expect(process.env.LANG).toBe("ru_RU.UTF-8");
});

test("a missing locale is repaired even when PATH short-circuits", () => {
	for (const key of LOCALE_VARS) delete process.env[key];
	process.env.PATH = "/opt/homebrew/bin:/usr/bin";

	resolveShellEnv();

	expect(process.env.LANG).toBeDefined();
});
