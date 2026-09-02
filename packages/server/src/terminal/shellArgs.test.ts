import { expect, test } from "bun:test";
import { terminalShell, terminalShellArgs } from "./shellArgs";

test("an explicit shell wins on every platform", () => {
	expect(terminalShell("win32", { SHELL: "C:\\tools\\bash.exe", ComSpec: "cmd.exe" })).toBe(
		"C:\\tools\\bash.exe",
	);
	expect(terminalShell("linux", { SHELL: "/bin/zsh" })).toBe("/bin/zsh");
});

test("Windows terminals fall back through ComSpec to cmd", () => {
	expect(terminalShell("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" })).toBe(
		"C:\\Windows\\System32\\cmd.exe",
	);
	expect(terminalShell("win32", { COMSPEC: "C:\\Windows\\System32\\cmd.exe" })).toBe(
		"C:\\Windows\\System32\\cmd.exe",
	);
	expect(terminalShell("win32", {})).toBe("cmd.exe");
});

test("Unix terminals retain the bash fallback", () => {
	expect(terminalShell("linux", {})).toBe("/bin/bash");
	expect(terminalShell("darwin", {})).toBe("/bin/bash");
});

test("macOS terminals start login shells", () => {
	expect(terminalShellArgs("darwin")).toEqual(["-l"]);
});

test("other platforms keep non-login shells", () => {
	expect(terminalShellArgs("linux")).toEqual([]);
	expect(terminalShellArgs("win32")).toEqual([]);
});
