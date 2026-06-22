import { afterEach, beforeEach, expect, test } from "bun:test";
import { pathLooksComplete, resolveShellEnv } from "./shellEnv";

let originalPath: string | undefined;
beforeEach(() => {
	originalPath = process.env.PATH;
});
afterEach(() => {
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
});

test("pathLooksComplete detects user dirs", () => {
	expect(pathLooksComplete("/usr/bin:/usr/local/bin")).toBe(true);
	expect(pathLooksComplete("/opt/homebrew/bin:/usr/bin")).toBe(true);
	expect(pathLooksComplete("/Users/x/.bun/bin:/usr/bin")).toBe(true);
	expect(pathLooksComplete("/usr/bin:/bin")).toBe(false);
});

test("resolveShellEnv is a no-op when PATH already looks complete", () => {
	process.env.PATH = "/opt/homebrew/bin:/usr/bin";
	resolveShellEnv();
	expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
});
