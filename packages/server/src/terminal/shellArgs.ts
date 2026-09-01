export function terminalShell(platform: string, env: Record<string, string | undefined>): string {
	if (env.SHELL) return env.SHELL;
	if (platform === "win32") return env.ComSpec ?? env.COMSPEC ?? "cmd.exe";
	return "/bin/bash";
}

export function terminalShellArgs(platform: string): string[] {
	return platform === "darwin" ? ["-l"] : [];
}
