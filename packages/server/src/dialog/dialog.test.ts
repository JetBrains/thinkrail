import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noPickerMessage, pickerFailure, pickersFor, selectDirectory } from "./dialog";

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

test("Windows picker: a PowerShell FolderBrowserDialog, -Sta, owned by a top-most form", () => {
	const pickers = pickersFor("win32");
	expect(pickers.map((p) => p.cmd[0])).toEqual(["powershell.exe", "pwsh.exe"]);
	for (const picker of pickers) {
		expect(picker.cmd).toContain("-Sta");
		const flag = picker.cmd.indexOf("-EncodedCommand");
		expect(flag).toBeGreaterThan(-1);
		const script = Buffer.from(picker.cmd[flag + 1] ?? "", "base64").toString("utf16le");
		expect(script).toContain("FolderBrowserDialog");
		expect(script).toContain("$owner.TopMost = $true");
		expect(script).toContain("$d.ShowDialog($owner)");
		expect(script).toContain("AttachThreadInput");
		expect(script).toContain("SetForegroundWindow($owner.Handle)");
		expect(script).toContain("AttachThreadInput($me, $fg, $true)");
		expect(script).toContain("AttachThreadInput($me, $fg, $false)");
		expect(script).toContain("} catch { }");
	}
});

test("pickers distinguish cancellation from a failed non-zero exit", () => {
	const execution = { stdout: "", stderr: "", code: 1 };
	expect(
		pickersFor("darwin")[0]?.isCancellation({
			...execution,
			stderr: "execution error: User canceled. (-128)",
		}),
	).toBe(true);
	expect(pickersFor("darwin")[0]?.isCancellation(execution)).toBe(false);
	for (const picker of pickersFor("linux")) {
		expect(picker.isCancellation(execution)).toBe(true);
		expect(picker.isCancellation({ ...execution, stderr: "Failed to open display" })).toBe(false);
	}
	for (const picker of pickersFor("win32")) {
		expect(picker.isCancellation(execution)).toBe(false);
	}
});

test("unknown platform has no native picker", () => {
	expect(pickersFor("sunos" as NodeJS.Platform)).toEqual([]);
});

test("a failed picker names a cause — never an empty message, never a stray CR", () => {
	expect(pickerFailure("Add-Type : Cannot load assembly\r\n  At line:1\r\n", 1)).toBe(
		"The folder picker failed: Add-Type : Cannot load assembly",
	);
	expect(pickerFailure("", 137)).toBe("The folder picker failed: exit 137");
	expect(pickerFailure("   \r\n \n", 1)).toBe("The folder picker failed: exit 1");
});

test("no runnable picker points at the fix on Linux, names the platform elsewhere", () => {
	expect(noPickerMessage("linux")).toContain("install zenity or kdialog");
	expect(noPickerMessage("sunos" as NodeJS.Platform)).toContain("(sunos)");
});

test("picker output is trimmed, trailing separators dropped, empty → null", () => {
	const parse = pickersFor("darwin")[0]?.parse;
	if (!parse) throw new Error("expected a darwin picker");
	expect(parse("/Users/me/project/\n")).toBe("/Users/me/project");
	expect(parse("C:\\Users\\me\\project\\")).toBe("C:\\Users\\me\\project");
	expect(parse("   ")).toBeNull();
	expect(parse("")).toBeNull();
});

test("THINKRAIL_PICK_DIR overrides the native picker", async () => {
	const saved = process.env.THINKRAIL_PICK_DIR;
	process.env.THINKRAIL_PICK_DIR = "/tmp/forced/repo";
	try {
		expect(await selectDirectory()).toEqual({ path: "/tmp/forced/repo" });
	} finally {
		if (saved === undefined) delete process.env.THINKRAIL_PICK_DIR;
		else process.env.THINKRAIL_PICK_DIR = saved;
	}
});

test("THINKRAIL_PICK_DIR reads its value from a file when it names one (live per call)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-pick-"));
	const pointer = join(dir, "pick-dir");
	const saved = process.env.THINKRAIL_PICK_DIR;
	process.env.THINKRAIL_PICK_DIR = pointer;
	try {
		writeFileSync(pointer, "/repos/alpha\n");
		expect(await selectDirectory()).toEqual({ path: "/repos/alpha" });
		writeFileSync(pointer, "/repos/beta");
		expect(await selectDirectory()).toEqual({ path: "/repos/beta" });
	} finally {
		if (saved === undefined) delete process.env.THINKRAIL_PICK_DIR;
		else process.env.THINKRAIL_PICK_DIR = saved;
		rmSync(dir, { recursive: true, force: true });
	}
});
