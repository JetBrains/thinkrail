import { readFileSync, statSync } from "node:fs";

interface PickerExecution {
	stdout: string;
	stderr: string;
	code: number;
}

export interface Picker {
	cmd: string[];
	parse: (stdout: string) => string | null;
	isCancellation: (execution: PickerExecution) => boolean;
}

type PickerRunner = (cmd: string[], env: NodeJS.ProcessEnv) => Promise<PickerExecution>;

interface SelectDirectoryOptions {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	runPicker?: PickerRunner;
}

const toPath = (stdout: string): string | null => stdout.trim().replace(/[/\\]+$/, "") || null;

const appleScriptCancellation = ({ stderr }: PickerExecution): boolean => stderr.includes("(-128)");
const linuxCancellation = ({ code, stderr }: PickerExecution): boolean =>
	code === 1 && stderr.trim() === "";
const noNonZeroCancellation = (): boolean => false;

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
					isCancellation: appleScriptCancellation,
				},
			];
		case "linux":
			return [
				{
					cmd: ["zenity", "--file-selection", "--directory", "--title=Open project"],
					parse: toPath,
					isCancellation: linuxCancellation,
				},
				{
					cmd: ["kdialog", "--getexistingdirectory", ".", "--title", "Open project"],
					parse: toPath,
					isCancellation: linuxCancellation,
				},
			];
		case "win32":
			return ["powershell.exe", "pwsh.exe"].map((shell) => ({
				cmd: [shell, "-NoProfile", "-Sta", "-EncodedCommand", ENCODED_WINDOWS_PICKER],
				parse: toPath,
				isCancellation: noNonZeroCancellation,
			}));
		default:
			return [];
	}
}

function resolveOverride(env: NodeJS.ProcessEnv): string | null {
	const value = env.THINKRAIL_PICK_DIR;
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

const defaultRunPicker: PickerRunner = async (cmd, env) => {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env });
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
};

export async function selectDirectory({
	platform = process.platform,
	env = process.env,
	runPicker = defaultRunPicker,
}: SelectDirectoryOptions = {}): Promise<{ path: string | null }> {
	const override = resolveOverride(env);
	if (override) return { path: override };
	if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
		throw new Error("No graphical session is available for the folder picker on this Linux host.");
	}

	let firstFailure: string | null = null;
	let diagnosticFailure: string | null = null;
	for (const picker of pickersFor(platform)) {
		let execution: PickerExecution;
		try {
			execution = await runPicker(picker.cmd, env);
		} catch {
			continue;
		}
		if (execution.code === 0) return { path: picker.parse(execution.stdout) };
		if (picker.isCancellation(execution)) return { path: null };
		const failure = pickerFailure(execution.stderr, execution.code);
		firstFailure ??= failure;
		if (execution.stderr.trim()) diagnosticFailure ??= failure;
	}
	throw new Error(diagnosticFailure ?? firstFailure ?? noPickerMessage(platform));
}
