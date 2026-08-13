import { expect, test } from "bun:test";
import { terminalShellArgs } from "./shellArgs";

test("macOS terminals start login shells", () => {
	expect(terminalShellArgs("darwin")).toEqual(["-l"]);
});

test("other platforms keep non-login shells", () => {
	expect(terminalShellArgs("linux")).toEqual([]);
	expect(terminalShellArgs("win32")).toEqual([]);
});
