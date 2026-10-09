import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	LOGIN_ENV_MARKER,
	localeRepair,
	loginShellImports,
	mergePath,
	parseLoginShellEnv,
	resolveShellEnv,
} from "./shellEnv";

const LOCALE_VARS = ["LANG", "LC_ALL", "LC_CTYPE"];
const IMPORT_VARS = ["TR_TEST_IMPORTED", "TR_TEST_PRESET", "PI_TEST_SHELL", "THINKRAIL_TEST_SHELL"];
const LAUNCHD_DEFAULT_PATH = "/Users/x/.pi/agent/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin";
const LOGIN_PATH =
	"/opt/homebrew/bin:/Users/x/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

let originalPath: string | undefined;
let originalShell: string | undefined;
let originalTerm: string | undefined;
let originalLocale: Record<string, string | undefined> = {};
let shellDir: string;

function fakeShell(script: string): void {
	const path = join(shellDir, "shell");
	writeFileSync(path, `#!/bin/sh\n${script}\n`);
	chmodSync(path, 0o755);
	process.env.SHELL = path;
}

beforeEach(() => {
	originalPath = process.env.PATH;
	originalShell = process.env.SHELL;
	originalTerm = process.env.TERM;
	originalLocale = Object.fromEntries(LOCALE_VARS.map((key) => [key, process.env[key]]));
	shellDir = mkdtempSync(join(tmpdir(), "shellenv-"));
	fakeShell(`printf '${LOGIN_ENV_MARKER}HOME=/Users/x\\0PATH=${LOGIN_PATH}\\0'`);
	process.env.PATH = LAUNCHD_DEFAULT_PATH;
});
afterEach(() => {
	rmSync(shellDir, { recursive: true, force: true });
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
	if (originalShell === undefined) delete process.env.SHELL;
	else process.env.SHELL = originalShell;
	if (originalTerm === undefined) delete process.env.TERM;
	else process.env.TERM = originalTerm;
	for (const key of LOCALE_VARS) {
		const value = originalLocale[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	for (const key of IMPORT_VARS) delete process.env[key];
});

const noProbe = () => null;

test("mergePath keeps explicit current entries ahead of the login PATH without duplicates", () => {
	expect(mergePath("/venv/bin:/usr/bin:/bin", "/opt/homebrew/bin:/usr/bin:/bin")).toBe(
		"/venv/bin:/opt/homebrew/bin:/usr/bin:/bin",
	);
	expect(mergePath("", "/usr/bin")).toBe("/usr/bin");
	expect(mergePath("/usr/bin::/bin", "/usr/bin:/bin")).toBe("/usr/bin:/bin");
});

test("resolveShellEnv adopts the login shell PATH from the launchd default", () => {
	resolveShellEnv();

	expect(process.env.PATH).toBe(`/Users/x/.pi/agent/bin:${LOGIN_PATH}`);
});

test("resolveShellEnv probes from a base PATH and keeps a terminal's extras in front", () => {
	fakeShell(`printf '${LOGIN_ENV_MARKER}PATH=/Users/x/.local/bin:%s\\0' "$PATH"`);
	process.env.PATH = `/work/.venv/bin:${LOGIN_PATH}`;

	resolveShellEnv();

	expect(process.env.PATH).toBe(
		"/work/.venv/bin:/opt/homebrew/bin:/Users/x/.bun/bin:/Users/x/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
	);
});

test("resolveShellEnv falls back to a non-interactive login shell", () => {
	fakeShell(`case "$*" in *-i*) exit 1;; esac\nprintf '${LOGIN_ENV_MARKER}PATH=${LOGIN_PATH}\\0'`);

	resolveShellEnv();

	expect(process.env.PATH).toBe(`/Users/x/.pi/agent/bin:${LOGIN_PATH}`);
});

test("resolveShellEnv leaves PATH untouched when the login shell fails", () => {
	fakeShell("exit 1");

	resolveShellEnv();

	expect(process.env.PATH).toBe(LAUNCHD_DEFAULT_PATH);
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

	resolveShellEnv({ probe: noProbe });

	expect(process.env.LANG).toMatch(/UTF-8$/);
	expect(process.env.LC_ALL).toBeUndefined();
	expect(process.env.LC_CTYPE).toBeUndefined();
});

test("resolveShellEnv leaves an existing locale untouched", () => {
	process.env.LANG = "ru_RU.UTF-8";

	resolveShellEnv({ probe: noProbe });

	expect(process.env.LANG).toBe("ru_RU.UTF-8");
});

test("parseLoginShellEnv ignores rc-file chatter before the marker and malformed entries", () => {
	const stdout = `Welcome back!\nfoo=bar\n__THINKRAIL_LOGIN_ENV__HOME=/Users/x\0PATH=/a:/b\0=bad\0noequals\0GITHUB_TOKEN=ghp_x\0`;
	const env = parseLoginShellEnv(stdout);
	expect(env).not.toBeNull();
	expect(env?.get("HOME")).toBe("/Users/x");
	expect(env?.get("GITHUB_TOKEN")).toBe("ghp_x");
	expect(env?.has("foo")).toBe(false);
	expect(parseLoginShellEnv("no marker here")).toBeNull();
});

test("loginShellImports adds only what the process lacks and never host-reserved or bookkeeping variables", () => {
	const imports = loginShellImports(
		{ HOME: "/Users/x", EXISTING: "keep" },
		new Map([
			["HOME", "/Users/other"],
			["EXISTING", "shell"],
			["GITHUB_TOKEN", "ghp_x"],
			["PATH", "/shell/path"],
			["PWD", "/somewhere"],
			["SHLVL", "2"],
			["_", "/usr/bin/env"],
			["PI_CODING_AGENT_DIR", "/tmp/pi"],
			["THINKRAIL_DEBUG", "1"],
		]),
	);
	expect(imports).toEqual({ GITHUB_TOKEN: "ghp_x" });
});

test("resolveShellEnv imports the login-shell environment only for a host launched without a terminal", () => {
	process.env.TR_TEST_PRESET = "process";
	const probe = () =>
		new Map([
			["TR_TEST_IMPORTED", "from-shell"],
			["TR_TEST_PRESET", "shell"],
			["PI_TEST_SHELL", "never"],
			["THINKRAIL_TEST_SHELL", "never"],
		]);

	process.env.TERM = "xterm-256color";
	resolveShellEnv({ probe });
	expect(process.env.TR_TEST_IMPORTED).toBeUndefined();

	delete process.env.TERM;
	resolveShellEnv({ probe });
	expect(process.env.TR_TEST_IMPORTED).toBe("from-shell");
	expect(process.env.TR_TEST_PRESET).toBe("process");
	expect(process.env.PI_TEST_SHELL).toBeUndefined();
	expect(process.env.THINKRAIL_TEST_SHELL).toBeUndefined();
});

test("the PATH repair and the import share one login-shell probe", () => {
	delete process.env.TERM;
	process.env.PATH = "/usr/bin:/bin";
	let probes = 0;
	resolveShellEnv({
		probe: () => {
			probes += 1;
			return new Map([["PATH", "/opt/homebrew/bin:/usr/bin:/bin"]]);
		},
	});
	expect(probes).toBe(1);
	expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
});
