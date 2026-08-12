/** Shell arguments matching each platform's terminal convention. */
export function terminalShellArgs(platform: string): string[] {
	return platform === "darwin" ? ["-l"] : [];
}
