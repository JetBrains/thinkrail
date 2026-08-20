import { readFileSync, statSync } from "node:fs";

export interface Picker {
	cmd: string[];
	parse: (stdout: string) => string | null;
	nonZeroExit: "cancel" | "error";
}

const toPath = (stdout: string): string | null => stdout.trim().replace(/[/\\]+$/, "") || null;

const WINDOWS_PICKER = [
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms",
	"$owner = New-Object System.Windows.Forms.Form",
	"$owner.TopMost = $true",
	"$owner.ShowInTaskbar = $false",
	"$owner.Opacity = 0",
	"$owner.Show()",
	"try {",
	"  Add-Type -Namespace ThinkRail -Name Fg -MemberDefinition '",
	'    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
	'    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w, IntPtr p);',
	'    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool join);',
	'    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w);',
	'    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();\'',
	"  $fg = [ThinkRail.Fg]::GetWindowThreadProcessId([ThinkRail.Fg]::GetForegroundWindow(), [IntPtr]::Zero)",
	"  $me = [ThinkRail.Fg]::GetCurrentThreadId()",
	"  [void][ThinkRail.Fg]::AttachThreadInput($me, $fg, $true)",
	"  [void][ThinkRail.Fg]::SetForegroundWindow($owner.Handle)",
	"  [void][ThinkRail.Fg]::AttachThreadInput($me, $fg, $false)",
	"} catch { }",
	"$d = New-Object System.Windows.Forms.FolderBrowserDialog",
	"$d.Description = 'Open project'",
	"$ok = $d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK",
	"$owner.Close()",
	"if ($ok) { Write-Output $d.SelectedPath }",
].join("\n");

const ENCODED_WINDOWS_PICKER = Buffer.from(WINDOWS_PICKER, "utf16le").toString("base64");

export function pickersFor(platform: NodeJS.Platform): Picker[] {
	switch (platform) {
		case "darwin":
			return [
				{
					cmd: ["osascript", "-e", 'POSIX path of (choose folder with prompt "Open project")'],
					parse: toPath,
					nonZeroExit: "cancel",
				},
			];
		case "linux":
			return [
				{
					cmd: ["zenity", "--file-selection", "--directory", "--title=Open project"],
					parse: toPath,
					nonZeroExit: "cancel",
				},
				{
					cmd: ["kdialog", "--getexistingdirectory", ".", "--title", "Open project"],
					parse: toPath,
					nonZeroExit: "cancel",
				},
			];
		case "win32":
			return ["powershell.exe", "pwsh.exe"].map((shell) => ({
				cmd: [shell, "-NoProfile", "-Sta", "-EncodedCommand", ENCODED_WINDOWS_PICKER],
				parse: toPath,
				nonZeroExit: "error" as const,
			}));
		default:
			return [];
	}
}

function resolveOverride(): string | null {
	const value = process.env.THINKRAIL_PICK_DIR;
	if (!value) return null;
	try {
		if (statSync(value).isFile()) return readFileSync(value, "utf8").trim() || null;
	} catch {}
	return value;
}

export function pickerFailure(stderr: string, code: number): string {
	const firstLine = stderr.replaceAll("\r", "").trim().split("\n")[0];
	return `The folder picker failed: ${firstLine || `exit ${code}`}`;
}

export function noPickerMessage(platform: NodeJS.Platform): string {
	return platform === "linux"
		? "No folder picker on this host — install zenity or kdialog."
		: `No native folder picker is available on this host (${platform}).`;
}

export async function selectDirectory(): Promise<{ path: string | null }> {
	const override = resolveOverride();
	if (override) return { path: override };

	for (const picker of pickersFor(process.platform)) {
		let out: string;
		let err: string;
		let code: number;
		try {
			const proc = Bun.spawn(picker.cmd, { stdout: "pipe", stderr: "pipe" });
			[out, err, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
		} catch {
			continue;
		}
		if (code === 0) return { path: picker.parse(out) };
		if (picker.nonZeroExit === "cancel") return { path: null };
		throw new Error(pickerFailure(err, code));
	}
	throw new Error(noPickerMessage(process.platform));
}
