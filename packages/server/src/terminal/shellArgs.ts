import type { TerminalWindowsShell } from "@thinkrail/contracts";

const WINDOWS_SHELL_BINARY: Record<Exclude<TerminalWindowsShell, "auto">, string> = {
	pwsh: "pwsh.exe",
	powershell: "powershell.exe",
	cmd: "cmd.exe",
};

export type WhichFn = (bin: string) => string | null;

export const defaultWhich: WhichFn = (bin) =>
	Bun.which(bin, { PATH: process.env.PATH ?? "" }) ?? null;

export function terminalShell(
	platform: string,
	env: Record<string, string | undefined>,
	preference: TerminalWindowsShell = "auto",
	which: WhichFn = defaultWhich,
): string {
	if (env.SHELL) return env.SHELL;
	if (platform !== "win32") return "/bin/bash";
	if (preference !== "auto") return WINDOWS_SHELL_BINARY[preference];
	return which("pwsh.exe") ?? "powershell.exe";
}

export function terminalShellArgs(platform: string): string[] {
	return platform === "darwin" ? ["-l"] : [];
}
