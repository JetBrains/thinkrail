import { expect, test } from "bun:test";
import { ptyLibraryName, runtimeTarget } from "./runtimeTarget";

test("maps every release target to its packaged PTY library", () => {
	expect(ptyLibraryName(runtimeTarget("darwin", "arm64"))).toBe("librust_pty_arm64.dylib");
	expect(ptyLibraryName(runtimeTarget("darwin", "x64"))).toBe("librust_pty.dylib");
	expect(ptyLibraryName(runtimeTarget("linux", "arm64"))).toBe("librust_pty_arm64.so");
	expect(ptyLibraryName(runtimeTarget("linux", "x64"))).toBe("librust_pty.so");
	expect(ptyLibraryName(runtimeTarget("win32", "x64"))).toBe("rust_pty.dll");
});

test("rejects unsupported desktop targets", () => {
	expect(() => runtimeTarget("win32", "arm64")).toThrow("unsupported desktop runtime target");
});
