import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	launchEnvKeys,
	LOGIN_ENV_END,
	LOGIN_ENV_MARKER,
	localeRepair,
	loginShellImports,
	loginShellProbe,
	mergePath,
	parseLoginShellEnv,
	repairShellEnv,
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
	fakeShell(`printf '${LOGIN_ENV_MARKER}HOME=/Users/x\\0PATH=${LOGIN_PATH}\\0${LOGIN_ENV_END}'`);
	process.env.PATH = LAUNCHD_DEFAULT_PATH;
});
afterEach(() => {
	delete (globalThis as Record<symbol, unknown>)[Symbol.for("thinkrail.shellEnv.pending")];
	delete (globalThis as Record<symbol, unknown>)[Symbol.for("thinkrail.shellEnv.launchKeys")];
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

const noProbe = async () => null;

test("mergePath keeps explicit current entries ahead of the login PATH without duplicates", () => {
	expect(mergePath("/venv/bin:/usr/bin:/bin", "/opt/homebrew/bin:/usr/bin:/bin")).toBe(
		"/venv/bin:/opt/homebrew/bin:/usr/bin:/bin",
	);
	expect(mergePath("", "/usr/bin")).toBe("/usr/bin");
	expect(mergePath("/usr/bin::/bin", "/usr/bin:/bin")).toBe("/usr/bin:/bin");
});

test("repairShellEnv adopts the login shell PATH from the launchd default", async () => {
	await repairShellEnv();

	expect(process.env.PATH).toBe(`/Users/x/.pi/agent/bin:${LOGIN_PATH}`);
});

test("repairShellEnv probes from a base PATH and keeps a terminal's extras in front", async () => {
	fakeShell(`printf '${LOGIN_ENV_MARKER}PATH=/Users/x/.local/bin:%s\\0${LOGIN_ENV_END}' "$PATH"`);
	process.env.PATH = `/work/.venv/bin:${LOGIN_PATH}`;

	await repairShellEnv();

	expect(process.env.PATH).toBe(
		"/work/.venv/bin:/opt/homebrew/bin:/Users/x/.bun/bin:/Users/x/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
	);
});

test("repairShellEnv falls back to a non-interactive login shell", async () => {
	fakeShell(
		`case "$*" in *-i*) exit 1;; esac\nprintf '${LOGIN_ENV_MARKER}PATH=${LOGIN_PATH}\\0${LOGIN_ENV_END}'`,
	);

	await repairShellEnv();

	expect(process.env.PATH).toBe(`/Users/x/.pi/agent/bin:${LOGIN_PATH}`);
});

test("repairShellEnv leaves PATH untouched when the login shell fails", async () => {
	fakeShell("exit 1");

	await repairShellEnv();

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

test("repairShellEnv installs LANG when the host has no locale at all", async () => {
	for (const key of LOCALE_VARS) delete process.env[key];

	await repairShellEnv({ probe: noProbe });

	expect(process.env.LANG).toMatch(/UTF-8$/);
	expect(process.env.LC_ALL).toBeUndefined();
	expect(process.env.LC_CTYPE).toBeUndefined();
});

test("repairShellEnv leaves an existing locale untouched", async () => {
	process.env.LANG = "ru_RU.UTF-8";

	await repairShellEnv({ probe: noProbe });

	expect(process.env.LANG).toBe("ru_RU.UTF-8");
});

test("parseLoginShellEnv reads only the entries between its markers", () => {
	const stdout = `Welcome back!\nfoo=bar\n${LOGIN_ENV_MARKER}HOME=/Users/x\0PATH=/a:/b\0=bad\0noequals\0GITHUB_TOKEN=ghp_x\0${LOGIN_ENV_END}logout chatter=1\0`;
	const env = parseLoginShellEnv(stdout);
	expect(env).not.toBeNull();
	expect(env?.get("HOME")).toBe("/Users/x");
	expect(env?.get("GITHUB_TOKEN")).toBe("ghp_x");
	expect(env?.has("foo")).toBe(false);
	expect(env?.has("logout chatter")).toBe(false);
	expect(parseLoginShellEnv("no marker here")).toBeNull();
});

test("parseLoginShellEnv rejects output that stops before its end marker", () => {
	expect(parseLoginShellEnv(`${LOGIN_ENV_MARKER}HOME=/Users/x\0PATH=/opt/home`)).toBeNull();
	expect(parseLoginShellEnv(`${LOGIN_ENV_MARKER}HOME=/Users/x\0PATH=/a:/b\0`)).toBeNull();
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

test("repairShellEnv imports the login-shell environment only for a host launched without a terminal", async () => {
	process.env.TR_TEST_PRESET = "process";
	const probe = async () =>
		new Map([
			["TR_TEST_IMPORTED", "from-shell"],
			["TR_TEST_PRESET", "shell"],
			["PI_TEST_SHELL", "never"],
			["THINKRAIL_TEST_SHELL", "never"],
		]);

	process.env.TERM = "xterm-256color";
	await repairShellEnv({ probe });
	expect(process.env.TR_TEST_IMPORTED).toBeUndefined();

	delete process.env.TERM;
	await repairShellEnv({ probe });
	expect(process.env.TR_TEST_IMPORTED).toBe("from-shell");
	expect(process.env.TR_TEST_PRESET).toBe("process");
	expect(process.env.PI_TEST_SHELL).toBeUndefined();
	expect(process.env.THINKRAIL_TEST_SHELL).toBeUndefined();
});

test("the PATH repair and the import share one login-shell probe", async () => {
	delete process.env.TERM;
	process.env.PATH = "/usr/bin:/bin";
	let probes = 0;
	await repairShellEnv({
		probe: async () => {
			probes += 1;
			return new Map([["PATH", "/opt/homebrew/bin:/usr/bin:/bin"]]);
		},
	});
	expect(probes).toBe(1);
	expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
});

test("the login shell probe does not block the event loop", async () => {
	const gate = join(shellDir, "gate");
	fakeShell(
		`while [ ! -e '${gate}' ]; do sleep 0.01; done\nprintf '${LOGIN_ENV_MARKER}PATH=${LOGIN_PATH}\\0${LOGIN_ENV_END}'`,
	);
	const order: string[] = [];
	const repair = repairShellEnv().then(() => order.push("repaired"));
	await new Promise((resolve) => setTimeout(resolve, 0));
	order.push("timer");
	writeFileSync(gate, "");
	await repair;
	expect(order).toEqual(["timer", "repaired"]);
	expect(process.env.PATH).toBe(`/Users/x/.pi/agent/bin:${LOGIN_PATH}`);
});

test("a login shell that stops before the end marker repairs nothing", async () => {
	fakeShell(`printf '${LOGIN_ENV_MARKER}HOME=/Users/x\\0PATH=/opt/home'`);

	await repairShellEnv();

	expect(process.env.PATH).toBe(LAUNCHD_DEFAULT_PATH);
});

function jobPids(file: string): number[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8").split(/\s+/).filter(Boolean).map(Number);
}

function running(pid: number): boolean {
	const state = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)])
		.stdout.toString()
		.trim();
	return state !== "" && !state.startsWith("Z");
}

async function settledPids(pids: number[]): Promise<number[]> {
	for (let attempt = 0; attempt < 100 && pids.some(running); attempt += 1) await Bun.sleep(20);
	return pids.filter(running);
}

test("a background job holding stdout neither holds the probe open nor drops the login PATH", async () => {
	const jobs = join(shellDir, "jobs");
	fakeShell(
		`sleep 30 &\necho $! >> '${jobs}'\nprintf '${LOGIN_ENV_MARKER}PATH=${LOGIN_PATH}\\0${LOGIN_ENV_END}'`,
	);
	try {
		await repairShellEnv();
		expect(process.env.PATH).toBe(`/Users/x/.pi/agent/bin:${LOGIN_PATH}`);
	} finally {
		for (const pid of jobPids(jobs).filter(running)) process.kill(pid, "SIGKILL");
	}
});

test("output after the end marker is drained so a chatty logout hook cannot stall the shell", async () => {
	fakeShell(
		`printf '${LOGIN_ENV_MARKER}PATH=${LOGIN_PATH}\\0${LOGIN_ENV_END}'\nhead -c 16777216 /dev/zero`,
	);

	await repairShellEnv();

	expect(process.env.PATH).toBe(`/Users/x/.pi/agent/bin:${LOGIN_PATH}`);
});

test("a hung interactive login shell that ignores SIGTERM is killed with its children", async () => {
	const jobs = join(shellDir, "jobs");
	fakeShell(
		`case "$*" in *-i*) trap '' TERM; sleep 30 & echo $! >> '${jobs}'; wait;; esac\nexit 1`,
	);
	try {
		await repairShellEnv({ probe: loginShellProbe(1000) });
		expect(process.env.PATH).toBe(LAUNCHD_DEFAULT_PATH);
		expect(jobPids(jobs)).toHaveLength(1);
		expect(await settledPids(jobPids(jobs))).toEqual([]);
	} finally {
		for (const pid of jobPids(jobs).filter(running)) process.kill(pid, "SIGKILL");
	}
});

test("every resolveShellEnv caller awaits the same run, across bundled copies", async () => {
	const run = resolveShellEnv();
	expect(resolveShellEnv()).toBe(run);
	const copySpecifier = `${import.meta.dir}/shellEnv.ts?bundled-copy`;
	const copy: typeof import("./shellEnv") = await import(copySpecifier);
	expect(copy.resolveShellEnv).not.toBe(resolveShellEnv);
	expect(copy.resolveShellEnv()).toBe(run);
	await run;
});

test("launchEnvKeys keeps the keys set before the shell repair, not the ones it imports", async () => {
	delete process.env.TERM;
	process.env.TR_TEST_PRESET = "launch";
	fakeShell(
		`printf '${LOGIN_ENV_MARKER}TR_TEST_IMPORTED=login\\0PATH=${LOGIN_PATH}\\0${LOGIN_ENV_END}'`,
	);
	const run = resolveShellEnv();
	await run;
	expect(process.env.TR_TEST_IMPORTED).toBe("login");
	expect(launchEnvKeys().has("TR_TEST_PRESET")).toBe(true);
	expect(launchEnvKeys().has("TR_TEST_IMPORTED")).toBe(false);
	const copy: typeof import("./shellEnv") = await import(
		`${import.meta.dir}/shellEnv.ts?bundled-copy-keys`
	);
	expect(copy.launchEnvKeys()).toBe(launchEnvKeys());
});

test("launchEnvKeys without a shell repair is the current environment", () => {
	process.env.TR_TEST_PRESET = "now";
	expect(launchEnvKeys().has("TR_TEST_PRESET")).toBe(true);
});
