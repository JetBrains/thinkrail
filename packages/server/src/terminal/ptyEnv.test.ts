import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { terminalPtyEnv, uidAccountName } from "./ptyEnv";

test("the user's own environment reaches the shell", () => {
	const env = terminalPtyEnv(
		"darwin",
		{ PATH: "/usr/bin", LANG: "en_US.UTF-8", NO_COLOR: "1" },
		() => "u",
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
		() => "u",
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
		() => "u",
	);
	expect(Object.keys(env).sort()).toEqual(["COLORTERM", "LOGNAME", "TERM", "TERM_PROGRAM", "USER"]);
});

test("parent-terminal size and screen variables bun-pty would otherwise strip stay out of the shell", () => {
	const env = terminalPtyEnv(
		"linux",
		{ WINDOW: "0", TERMCAP: "SC|screen:", COLUMNS: "120", LINES: "40", HOME: "/home/u" },
		() => "u",
	);
	expect(env.HOME).toBe("/home/u");
	for (const name of ["WINDOW", "TERMCAP", "COLUMNS", "LINES"]) expect(env[name]).toBeUndefined();
});

test("VS Code's askpass overrides leave together with the support variables they need", () => {
	const env = terminalPtyEnv(
		"darwin",
		{
			GIT_ASKPASS: "/vscode/askpass.sh",
			VSCODE_GIT_ASKPASS_NODE: "/vscode/node",
			VSCODE_GIT_ASKPASS_MAIN: "/vscode/askpass-main.js",
			VSCODE_GIT_IPC_HANDLE: "/tmp/vscode-git.sock",
			SSH_ASKPASS: "/vscode/ssh-askpass.sh",
			SSH_ASKPASS_REQUIRE: "force",
			VSCODE_SSH_ASKPASS_NODE: "/vscode/node",
			VSCODE_SSH_ASKPASS_MAIN: "/vscode/ssh-askpass-main.js",
		},
		() => "u",
	);
	expect(Object.keys(env).sort()).toEqual(["COLORTERM", "LOGNAME", "TERM", "TERM_PROGRAM", "USER"]);
});

test("a user's own askpass helpers are kept when VS Code did not install them", () => {
	const env = terminalPtyEnv(
		"linux",
		{
			GIT_ASKPASS: "/usr/lib/ssh/x11-ssh-askpass",
			SSH_ASKPASS: "/usr/lib/ssh/x11-ssh-askpass",
			SSH_ASKPASS_REQUIRE: "prefer",
		},
		() => "u",
	);
	expect(env.GIT_ASKPASS).toBe("/usr/lib/ssh/x11-ssh-askpass");
	expect(env.SSH_ASKPASS).toBe("/usr/lib/ssh/x11-ssh-askpass");
	expect(env.SSH_ASKPASS_REQUIRE).toBe("prefer");
});

test("only the askpass pair VS Code owns is dropped", () => {
	const env = terminalPtyEnv(
		"linux",
		{
			GIT_ASKPASS: "/vscode/askpass.sh",
			VSCODE_GIT_ASKPASS_MAIN: "/vscode/askpass-main.js",
			SSH_ASKPASS: "/usr/lib/ssh/x11-ssh-askpass",
		},
		() => "u",
	);
	expect(env.GIT_ASKPASS).toBeUndefined();
	expect(env.SSH_ASKPASS).toBe("/usr/lib/ssh/x11-ssh-askpass");
});

test("USER and LOGNAME come from the account, never the inherited or utmp-derived value", () => {
	const env = terminalPtyEnv("darwin", { USER: "root", LOGNAME: "root" }, () => "commander");
	expect(env.USER).toBe("commander");
	expect(env.LOGNAME).toBe("commander");
});

test("Windows keeps its own account variables untouched", () => {
	const env = terminalPtyEnv("win32", { USERNAME: "dev" }, () => "dev");
	expect(env.USERNAME).toBe("dev");
	expect(env.USER).toBeUndefined();
	expect(env.LOGNAME).toBeUndefined();
});

test("without a resolvable account, the inherited USER and LOGNAME are kept", () => {
	const env = terminalPtyEnv("linux", { USER: "dev", LOGNAME: "dev" }, () => null);
	expect(env.USER).toBe("dev");
	expect(env.LOGNAME).toBe("dev");
});

test.skipIf(process.platform === "win32")("the account name is resolved from the uid", () => {
	const id = Bun.spawnSync(["id", "-u", uidAccountName() ?? ""]);
	expect(id.stdout.toString().trim()).toBe(String(process.getuid?.()));
});

test.skipIf(process.platform === "win32")(
	"variables the host was started with reach a PTY only through the filtered environment",
	async () => {
		const script = `
			import { spawn } from "bun-pty";
			import { terminalPtyEnv } from ${JSON.stringify(join(import.meta.dir, "ptyEnv.ts"))};
			const pty = spawn("/bin/sh", ["-c", 'printf "%s|%s|%s|%s|%s|EN""D" "$(id -u "$LOGNAME")" "$(id -u "$USER")" "$TERM_PROGRAM" "\${FORCE_COLOR-unset}" "\${ZZ_HOST_ONLY-unset}"'], {
				cwd: ${JSON.stringify(tmpdir())},
				env: terminalPtyEnv(process.platform, { ...process.env, ZZ_HOST_ONLY: undefined }),
			});
			let out = "";
			pty.onData((data) => {
				out += data;
				if (out.includes("|END")) {
					process.stdout.write(out);
					process.exit(0);
				}
			});
		`;
		const { USER: _user, ...hostEnv } = process.env;
		const child = Bun.spawn([process.execPath, "-e", script], {
			cwd: join(import.meta.dir, "..", ".."),
			env: {
				...hostEnv,
				LOGNAME: "root",
				TERM_PROGRAM: "Apple_Terminal",
				FORCE_COLOR: "0",
				ZZ_HOST_ONLY: "1",
			},
			stdout: "pipe",
			stderr: "inherit",
		});
		const output = await new Response(child.stdout).text();
		const uid = process.getuid?.();
		expect(output).toContain(`${uid}|${uid}|ThinkRail|unset|unset|END`);
	},
	30_000,
);
