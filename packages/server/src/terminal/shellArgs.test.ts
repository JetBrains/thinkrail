import { expect, test } from "bun:test";
import { terminalShell, terminalShellArgs } from "./shellArgs";

const noPwsh = () => null;
const withPwsh = (bin: string) => (bin === "pwsh.exe" ? "C:\\pwsh\\pwsh.exe" : null);

test("an explicit shell wins on every platform, over any preference", () => {
	expect(terminalShell("win32", { SHELL: "C:\\tools\\bash.exe" }, "cmd", withPwsh)).toBe(
		"C:\\tools\\bash.exe",
	);
	expect(terminalShell("linux", { SHELL: "/bin/zsh" })).toBe("/bin/zsh");
});

test("auto prefers pwsh when it resolves on PATH", () => {
	expect(terminalShell("win32", {}, "auto", withPwsh)).toBe("C:\\pwsh\\pwsh.exe");
});

test("auto falls back to Windows PowerShell when pwsh is not installed", () => {
	expect(terminalShell("win32", {}, "auto", noPwsh)).toBe("powershell.exe");
	expect(terminalShell("win32", {})).toBe("powershell.exe");
});

test("an explicit preference is a literal pin, never probed or substituted", () => {
	expect(terminalShell("win32", {}, "pwsh", noPwsh)).toBe("pwsh.exe");
	expect(terminalShell("win32", {}, "powershell", noPwsh)).toBe("powershell.exe");
	expect(terminalShell("win32", {}, "cmd", withPwsh)).toBe("cmd.exe");
});

test("ComSpec/COMSPEC no longer influence the Windows default", () => {
	expect(
		terminalShell("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "auto", noPwsh),
	).toBe("powershell.exe");
	expect(
		terminalShell("win32", { COMSPEC: "C:\\Windows\\System32\\cmd.exe" }, "auto", noPwsh),
	).toBe("powershell.exe");
});

test("Unix terminals retain the bash fallback regardless of preference", () => {
	expect(terminalShell("linux", {})).toBe("/bin/bash");
	expect(terminalShell("darwin", {}, "cmd")).toBe("/bin/bash");
});

test("macOS terminals start login shells", () => {
	expect(terminalShellArgs("darwin")).toEqual(["-l"]);
});

test("other platforms keep non-login shells", () => {
	expect(terminalShellArgs("linux")).toEqual([]);
	expect(terminalShellArgs("win32")).toEqual([]);
});
