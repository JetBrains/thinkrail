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

for (const picker of pickersFor("win32")) {
	const shell = picker.cmd[0] ?? "";
	test.skipIf(process.platform !== "win32" || (shell === "pwsh.exe" && !Bun.which(shell)))(
		`Windows picker preserves Unicode through ${shell} stdout under a legacy code page`,
		async () => {
			const flag = picker.cmd.indexOf("-EncodedCommand");
			expect(flag).toBeGreaterThan(-1);
			const script = Buffer.from(picker.cmd[flag + 1] ?? "", "base64").toString("utf16le");
			const lines = script.split("\n");
			const gui = lines.indexOf("Add-Type -AssemblyName System.Windows.Forms");
			const output = lines.at(-1) ?? "";
			expect(gui).toBeGreaterThan(0);
			expect(output).toBe("if ($ok) { Write-Output $d.SelectedPath }");
			const headless = [
				...lines.slice(0, gui),
				"$d = [pscustomobject]@{ SelectedPath = $env:THINKRAIL_TEST_PICKED_PATH }",
				"$ok = [bool]$env:THINKRAIL_TEST_PICKED_PATH",
				output,
			].join("\n");
			const cmd = [...picker.cmd];
			cmd[flag + 1] = Buffer.from(
				`[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(936)\n${headless}`,
				"utf16le",
			).toString("base64");
			for (const path of [
				"C:\\Users\\tester\\Documents\\ascii-test",
				"C:\\Users\\tester\\Documents\\中文测试",
				"C:\\test folder\\日本語-🚀",
				"C:\\café\\проект",
				"C:\\",
				"\\\\server\\share\\中文",
				"",
			]) {
				const proc = Bun.spawn(cmd, {
					stdout: "pipe",
					stderr: "pipe",
					env: { ...process.env, THINKRAIL_TEST_PICKED_PATH: path },
					windowsHide: true,
					timeout: 10_000,
				});
				const [stdout, stderr, code] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
					proc.exited,
				]);
				expect(code, stderr).toBe(0);
				expect(picker.parse(stdout)).toBe(path || null);
			}
		},
		30_000,
	);
}

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

test("headless Linux fails before spawning a graphical picker", async () => {
	let spawned = false;
	await expect(
		selectDirectory({
			platform: "linux",
			env: {},
			runPicker: async () => {
				spawned = true;
				return { stdout: "", stderr: "", code: 0 };
			},
		}),
	).rejects.toThrow("No graphical session");
	expect(spawned).toBe(false);
});

test("a genuine Linux cancel returns null and does not open the fallback picker", async () => {
	const commands: string[] = [];
	const result = await selectDirectory({
		platform: "linux",
		env: { DISPLAY: ":1" },
		runPicker: async ([command]) => {
			commands.push(command ?? "");
			return { stdout: "", stderr: "", code: 1 };
		},
	});
	expect(result).toEqual({ path: null });
	expect(commands).toEqual(["zenity"]);
});

test("a failed Linux picker falls through to the next candidate", async () => {
	const commands: string[] = [];
	const result = await selectDirectory({
		platform: "linux",
		env: { DISPLAY: ":1" },
		runPicker: async ([command]) => {
			commands.push(command ?? "");
			return command === "zenity"
				? { stdout: "", stderr: "Gtk-WARNING: Failed to open display", code: 1 }
				: { stdout: "/repos/fallback\n", stderr: "", code: 0 };
		},
	});
	expect(result).toEqual({ path: "/repos/fallback" });
	expect(commands).toEqual(["zenity", "kdialog"]);
});

test("picker exhaustion throws a diagnostic instead of cancellation", async () => {
	await expect(
		selectDirectory({
			platform: "linux",
			env: { WAYLAND_DISPLAY: "wayland-0" },
			runPicker: async ([command]) => ({
				stdout: "",
				stderr: command === "zenity" ? "Gtk-WARNING: Failed to open display" : "",
				code: command === "zenity" ? 1 : 254,
			}),
		}),
	).rejects.toThrow("Failed to open display");
});

test("picker output is trimmed, the platform's trailing separators dropped, empty → null", () => {
	const posix = pickersFor("darwin")[0]?.parse;
	const windows = pickersFor("win32")[0]?.parse;
	if (!posix || !windows) throw new Error("expected darwin and win32 pickers");
	expect(posix("/Users/me/project/\n")).toBe("/Users/me/project");
	expect(posix("/Users/me/odd\\")).toBe("/Users/me/odd\\");
	expect(windows("C:\\Users\\me\\project\\\r\n")).toBe("C:\\Users\\me\\project");
	for (const parse of [posix, windows]) {
		expect(parse("   ")).toBeNull();
		expect(parse("")).toBeNull();
	}
});

test("a picked filesystem root stays a root", () => {
	const posix = pickersFor("linux")[0]?.parse;
	const windows = pickersFor("win32")[0]?.parse;
	if (!posix || !windows) throw new Error("expected linux and win32 pickers");
	expect(posix("/\n")).toBe("/");
	expect(windows("C:\\")).toBe("C:\\");
	expect(windows("D:/")).toBe("D:/");
	expect(windows("\\\\server\\share\\")).toBe("\\\\server\\share\\");
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

test("a picker override file can force a deterministic failure before native selection", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-pick-"));
	const pointer = join(dir, "pick-dir");
	writeFileSync(pointer, "error:Deterministic picker failure");
	let spawned = false;
	try {
		await expect(
			selectDirectory({
				platform: "win32",
				env: { THINKRAIL_PICK_DIR: pointer },
				runPicker: async () => {
					spawned = true;
					return { stdout: "", stderr: "", code: 0 };
				},
			}),
		).rejects.toThrow("Deterministic picker failure");
		expect(spawned).toBe(false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
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
