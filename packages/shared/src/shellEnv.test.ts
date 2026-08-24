import { afterEach, beforeEach, expect, test } from "bun:test";
import { localeRepair, pathLooksComplete, resolveShellEnv } from "./shellEnv";

const LOCALE_VARS = ["LANG", "LC_ALL", "LC_CTYPE"];

let originalPath: string | undefined;
let originalLocale: Record<string, string | undefined> = {};
beforeEach(() => {
	originalPath = process.env.PATH;
	originalLocale = Object.fromEntries(LOCALE_VARS.map((key) => [key, process.env[key]]));
});
afterEach(() => {
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
	for (const key of LOCALE_VARS) {
		const value = originalLocale[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test("pathLooksComplete detects user dirs", () => {
	expect(pathLooksComplete("/usr/bin:/usr/local/bin")).toBe(true);
	expect(pathLooksComplete("/opt/homebrew/bin:/usr/bin")).toBe(true);
	expect(pathLooksComplete("/Users/x/.bun/bin:/usr/bin")).toBe(true);
	expect(pathLooksComplete("/usr/bin:/bin")).toBe(false);
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
