import { expect, test } from "bun:test";
import { pickersFor, selectDirectory } from "./dialog";

test("macOS picker uses osascript 'choose folder'", () => {
	const pickers = pickersFor("darwin");
	expect(pickers).toHaveLength(1);
	expect(pickers[0]?.cmd[0]).toBe("osascript");
	expect(pickers[0]?.cmd.join(" ")).toContain("choose folder");
});

test("Linux picker tries zenity then kdialog, both as directory pickers", () => {
	const pickers = pickersFor("linux");
	expect(pickers.map((p) => p.cmd[0])).toEqual(["zenity", "kdialog"]);
	expect(pickers[0]?.cmd).toContain("--directory");
	expect(pickers[1]?.cmd).toContain("--getexistingdirectory");
});

test("Windows picker uses a PowerShell FolderBrowserDialog", () => {
	const pickers = pickersFor("win32");
	expect(pickers).toHaveLength(1);
	expect(pickers[0]?.cmd[0]).toBe("powershell");
	expect(pickers[0]?.cmd.join(" ")).toContain("FolderBrowserDialog");
});

test("unknown platform has no native picker", () => {
	expect(pickersFor("sunos" as NodeJS.Platform)).toEqual([]);
});

test("picker output is trimmed, trailing separators dropped, empty → null", () => {
	const parse = pickersFor("darwin")[0]?.parse;
	if (!parse) throw new Error("expected a darwin picker");
	expect(parse("/Users/me/project/\n")).toBe("/Users/me/project");
	expect(parse("C:\\Users\\me\\project\\")).toBe("C:\\Users\\me\\project");
	expect(parse("   ")).toBeNull();
	expect(parse("")).toBeNull();
});

test("THINKRAIL_PI_PICK_DIR overrides the native picker", async () => {
	const saved = process.env.THINKRAIL_PI_PICK_DIR;
	process.env.THINKRAIL_PI_PICK_DIR = "/tmp/forced/repo";
	try {
		expect(await selectDirectory()).toEqual({ path: "/tmp/forced/repo" });
	} finally {
		if (saved === undefined) delete process.env.THINKRAIL_PI_PICK_DIR;
		else process.env.THINKRAIL_PI_PICK_DIR = saved;
	}
});
