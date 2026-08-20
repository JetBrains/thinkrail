export function terminalShellArgs(platform: string): string[] {
	return platform === "darwin" ? ["-l"] : [];
}
