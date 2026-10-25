const INHERITED_NAMES: ReadonlySet<string> = new Set([
	"PWD",
	"OLDPWD",
	"SHLVL",
	"_",
	"BUN_PTY_LIB",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"TERM_SESSION_ID",
	"TERMINAL_EMULATOR",
	"LC_TERMINAL",
	"LC_TERMINAL_VERSION",
	"COLORFGBG",
	"WINDOWID",
	"WT_SESSION",
	"WT_PROFILE_ID",
	"TMUX",
	"TMUX_PANE",
	"STY",
	"FORCE_COLOR",
	"CLICOLOR_FORCE",
	"DEBUG_COLORS",
	"CLAUDECODE",
]);

const INHERITED_PREFIXES = [
	"THINKRAIL_",
	"PI_",
	"ELECTROBUN_",
	"JITI_",
	"ITERM_",
	"VSCODE_",
	"KITTY_",
	"ALACRITTY_",
	"WEZTERM_",
	"GHOSTTY_",
	"KONSOLE_",
	"CLAUDE_CODE_",
];

function isInherited(name: string): boolean {
	return INHERITED_NAMES.has(name) || INHERITED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

let cachedAccountName: string | null | undefined;

export function uidAccountName(): string | null {
	if (cachedAccountName === undefined) {
		try {
			const id = Bun.spawnSync(["id", "-un"], { stdin: "ignore", stderr: "ignore" });
			cachedAccountName = (id.success && id.stdout.toString().trim()) || null;
		} catch {
			cachedAccountName = null;
		}
	}
	return cachedAccountName;
}

export function terminalPtyEnv(
	platform: string,
	env: Record<string, string | undefined>,
	accountName: () => string | null = uidAccountName,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (typeof value === "string" && !isInherited(name)) result[name] = value;
	}
	result.TERM = "xterm-256color";
	result.COLORTERM = "truecolor";
	result.TERM_PROGRAM = "ThinkRail";
	const account = platform === "win32" ? null : accountName();
	if (account) {
		result.USER = account;
		result.LOGNAME = account;
	}
	return result;
}
