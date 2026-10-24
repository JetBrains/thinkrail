import { expect, test } from "bun:test";
import { terminalPtyEnv } from "./ptyEnv";

test("the user's own environment reaches the shell", () => {
	const env = terminalPtyEnv(
		"darwin",
		{ PATH: "/usr/bin", LANG: "en_US.UTF-8", NO_COLOR: "1" },
		"u",
	);
	expect(env.PATH).toBe("/usr/bin");
	expect(env.LANG).toBe("en_US.UTF-8");
	expect(env.NO_COLOR).toBe("1");
});

test("the launching terminal's identity and colour forcing do not leak into the shell", () => {
	const env = terminalPtyEnv(
		"darwin",
		{
			TERM: "dumb",
			COLORTERM: "",
			TERM_PROGRAM: "Apple_Terminal",
			TERM_PROGRAM_VERSION: "455",
			TERM_SESSION_ID: "abc",
			TERMINAL_EMULATOR: "JetBrains-JediTerm",
			ITERM_SESSION_ID: "w0t0p0",
			VSCODE_INJECTION: "1",
			TMUX: "/tmp/tmux-501/default,1,0",
			FORCE_COLOR: "0",
			DEBUG_COLORS: "1",
			CLAUDECODE: "1",
			PWD: "/elsewhere",
			SHLVL: "3",
		},
		"u",
	);
	expect(env).toEqual({
		TERM: "xterm-256color",
		COLORTERM: "truecolor",
		TERM_PROGRAM: "ThinkRail",
		USER: "u",
		LOGNAME: "u",
	});
});

test("host-internal variables stay out of the shell", () => {
	const env = terminalPtyEnv(
		"linux",
		{
			THINKRAIL_PORT: "24242",
			PI_OFFLINE: "1",
			ELECTROBUN_LAUNCHER_PID: "1",
			JITI_TRY_NATIVE: "false",
			BUN_PTY_LIB: "/app/librust_pty.dylib",
		},
		"u",
	);
	expect(Object.keys(env).sort()).toEqual(["COLORTERM", "LOGNAME", "TERM", "TERM_PROGRAM", "USER"]);
});

test("USER and LOGNAME come from the account, never the inherited or utmp-derived value", () => {
	const env = terminalPtyEnv("darwin", { USER: "root", LOGNAME: "root" }, "commander");
	expect(env.USER).toBe("commander");
	expect(env.LOGNAME).toBe("commander");
});

test("Windows keeps its own account variables untouched", () => {
	const env = terminalPtyEnv("win32", { USERNAME: "dev" }, "dev");
	expect(env.USERNAME).toBe("dev");
	expect(env.USER).toBeUndefined();
	expect(env.LOGNAME).toBeUndefined();
});
