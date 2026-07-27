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
		// The script travels base64 UTF-16LE (`-EncodedCommand`), so its C# survives the command line.
		const flag = picker.cmd.indexOf("-EncodedCommand");
		expect(flag).toBeGreaterThan(-1);
		const script = Buffer.from(picker.cmd[flag + 1] ?? "", "base64").toString("utf16le");
		expect(script).toContain("FolderBrowserDialog");
		// Owned by a top-most form, or the dialog opens behind the browser and reads as a dead button…
		expect(script).toContain("$owner.TopMost = $true");
		expect(script).toContain("$d.ShowDialog($owner)");
		// …and top-most alone leaves the browser active, so the dialog would open without the keyboard.
		expect(script).toContain("AttachThreadInput");
		expect(script).toContain("SetForegroundWindow($owner.Handle)");
		// Attach and detach in pairs: leaving our input thread joined to another process' would make that
		// app's keyboard state ours for as long as the picker lives.
		expect(script).toContain("AttachThreadInput($me, $fg, $true)");
		expect(script).toContain("AttachThreadInput($me, $fg, $false)");
		// The grab is best-effort — a host that can't compile the P/Invoke still gets a dialog.
		expect(script).toContain("} catch { }");
	}
});

test("only PowerShell reads a non-zero exit as a failure — the others cancel", () => {
	expect(pickersFor("darwin").map((p) => p.nonZeroExit)).toEqual(["cancel"]);
	expect(pickersFor("linux").map((p) => p.nonZeroExit)).toEqual(["cancel", "cancel"]);
	expect(pickersFor("win32").map((p) => p.nonZeroExit)).toEqual(["error", "error"]);
});

test("unknown platform has no native picker", () => {
	expect(pickersFor("sunos" as NodeJS.Platform)).toEqual([]);
});

test("a failed picker names a cause — never an empty message, never a stray CR", () => {
	expect(pickerFailure("Add-Type : Cannot load assembly\r\n  At line:1\r\n", 1)).toBe(
		"The folder picker failed: Add-Type : Cannot load assembly",
	);
	// A killed picker writes nothing to stderr — the exit code is all we have to show.
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
		// Rewriting the pointer switches the returned dir without touching the env — re-read per call, so
		// one host can hand different folders to different e2e tests.
		writeFileSync(pointer, "/repos/beta");
		expect(await selectDirectory()).toEqual({ path: "/repos/beta" });
	} finally {
		if (saved === undefined) delete process.env.THINKRAIL_PICK_DIR;
		else process.env.THINKRAIL_PICK_DIR = saved;
		rmSync(dir, { recursive: true, force: true });
	}
});
