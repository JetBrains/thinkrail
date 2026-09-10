param([Parameter(Mandatory=$true)][string]$Launcher, [Parameter(Mandatory=$true)][string]$Sandbox, [Parameter(Mandatory=$true)][string]$Evidence)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class ChromeNative {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int size; public RECT monitor, work; public uint flags; }
    [StructLayout(LayoutKind.Sequential)] struct TITLEBARINFOEX { public int cbSize; public RECT rcTitleBar; [MarshalAs(UnmanagedType.ByValArray, SizeConst=6)] public uint[] states; [MarshalAs(UnmanagedType.ByValArray, SizeConst=6)] public RECT[] rectangles; }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO { public int cb; public IntPtr reserved, desktop, title; public int x, y, width, height, xChars, yChars, fill, flags; public short show, reservedSize; public IntPtr reservedData, stdin, stdout, stderr; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESSINFO { public IntPtr process, thread; public int pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct LIMITS { public long processTime, jobTime; public uint flags; public UIntPtr minWorkingSet, maxWorkingSet; public uint active; public UIntPtr affinity; public uint priority, scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct JOBLIMITS { public LIMITS basic; public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long user, kernel, periodUser, periodKernel; public uint faults, total, active, terminated; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref JOBLIMITS limits, int size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out ACCOUNTING info, int size, IntPtr length);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref STARTUPINFO startup, out PROCESSINFO info);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out int pid);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError=true)] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", SetLastError=true)] static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", SetLastError=true)] static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
    static IntPtr job, root, app, window;
    static int rootPid, appPid;
    public static string AppCreationTime;
    static void Require(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static string Creation(IntPtr process) { long creation, exit, kernel, user; Require(GetProcessTimes(process, out creation, out exit, out kernel, out user)); return creation.ToString(); }
    public static object Start(string launcher, string cwd) {
        job = CreateJobObject(IntPtr.Zero, null); Require(job != IntPtr.Zero);
        JOBLIMITS limits = new JOBLIMITS(); limits.basic.flags = 0x2000;
        Require(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(limits)));
        STARTUPINFO startup = new STARTUPINFO(); startup.cb = Marshal.SizeOf(startup); startup.flags = 0x100;
        startup.stdin = GetStdHandle(-10); startup.stdout = GetStdHandle(-11); startup.stderr = GetStdHandle(-12);
        foreach (IntPtr handle in new[] { startup.stdin, startup.stdout, startup.stderr }) Require(SetHandleInformation(handle, 1, 1));
        PROCESSINFO info;
        Require(CreateProcess(launcher, new StringBuilder("\"" + launcher + "\""), IntPtr.Zero, IntPtr.Zero, true, 0x08000004, IntPtr.Zero, cwd, ref startup, out info));
        root = info.process; rootPid = info.pid;
        try {
            if (!AssignProcessToJobObject(job, root)) { int error = Marshal.GetLastWin32Error(); TerminateProcess(root, 1); throw new Win32Exception(error); }
            string creation = Creation(root);
            Require(ResumeThread(info.thread) != UInt32.MaxValue);
            return new { pid = rootPid, creationTime = creation, ownership = "private kill-on-close job; assigned before resume" };
        } finally { CloseHandle(info.thread); }
    }
    public static uint Active() { if (job == IntPtr.Zero) return 0; ACCOUNTING info; Require(QueryInformationJobObject(job, 1, out info, Marshal.SizeOf(typeof(ACCOUNTING)), IntPtr.Zero)); return info.active; }
    public static void KillOwned() { Require(TerminateJobObject(job, 1)); }
    static uint ExitCode(IntPtr process) { if (process == IntPtr.Zero) return 0; uint code; Require(GetExitCodeProcess(process, out code)); return code; }
    public static uint LauncherExitCode() { return ExitCode(root); }
    public static uint AppExitCode() { return ExitCode(app); }
    public static void Close() { if (app != IntPtr.Zero) CloseHandle(app); if (root != IntPtr.Zero) CloseHandle(root); if (job != IntPtr.Zero) CloseHandle(job); }
    static void Verify(IntPtr hwnd, int pid) {
        if (app == IntPtr.Zero) {
            app = OpenProcess(0x101000, false, pid); Require(app != IntPtr.Zero);
            bool member; Require(IsProcessInJob(app, job, out member));
            if (!member) throw new Exception("Ready PID is outside the owned job");
            appPid = pid; AppCreationTime = Creation(app);
        }
        int owner;
        if (pid != appPid || WaitForSingleObject(app, 0) != 258 || GetWindowThreadProcessId(hwnd, out owner) == 0 || owner != pid || GetAncestor(hwnd, 2) != hwnd || (window != IntPtr.Zero && window != hwnd)) throw new Exception("App HWND/PID identity changed or is not a live owned top-level window");
        window = hwnd;
    }
    public static void Foreground(long handle, int pid) { IntPtr hwnd = new IntPtr(handle); Verify(hwnd, pid); if (GetForegroundWindow() != hwnd) throw new Exception("Foreground is not owned by the probe; aborting without reactivation"); }
    static bool Send(IntPtr hwnd, int pid, uint message, IntPtr argument, out UIntPtr result) { Verify(hwnd, pid); return SendMessageTimeout(hwnd, message, UIntPtr.Zero, argument, 0x23, 200, out result) != IntPtr.Zero; }
    public static object Read(long handle, int pid) {
        IntPtr hwnd = new IntPtr(handle); Foreground(handle, pid);
        IntPtr context = GetWindowDpiAwarenessContext(hwnd);
        if (GetAwarenessFromDpiAwarenessContext(context) != 2) throw new Exception("Expected a per-monitor-DPI-aware candidate window");
        IntPtr previous = SetThreadDpiAwarenessContext(context); Require(previous != IntPtr.Zero);
        try {
            RECT rect, client, caption, visibleFrame; Require(GetWindowRect(hwnd, out rect)); Require(GetClientRect(hwnd, out client));
            POINT first = new POINT { x = client.left, y = client.top }, last = new POINT { x = client.right, y = client.bottom };
            Require(ClientToScreen(hwnd, ref first)); Require(ClientToScreen(hwnd, ref last));
            client = new RECT { left = first.x, top = first.y, right = last.x, bottom = last.y };
            MONITORINFO monitor = new MONITORINFO(); monitor.size = Marshal.SizeOf(monitor); Require(GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref monitor));
            int captionResult = DwmGetWindowAttribute(hwnd, 5, out caption, 16), frameResult = DwmGetWindowAttribute(hwnd, 9, out visibleFrame, 16);
            TITLEBARINFOEX title = new TITLEBARINFOEX { cbSize = Marshal.SizeOf(typeof(TITLEBARINFOEX)), states = new uint[6], rectangles = new RECT[6] };
            IntPtr memory = Marshal.AllocHGlobal(title.cbSize); object titleData = null; bool delivered;
            try { Marshal.StructureToPtr(title, memory, false); UIntPtr result; delivered = Send(hwnd, pid, 0x33f, memory, out result); if (delivered) titleData = Marshal.PtrToStructure(memory, typeof(TITLEBARINFOEX)); } finally { Marshal.FreeHGlobal(memory); }
            var edges = new List<object>(); string[] names = { "top-left", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left" };
            int l = rect.left + 1, r = rect.right - 2, t = rect.top + 1, b = rect.bottom - 2, x = (l + r) / 2, y = (t + b) / 2;
            int[,] points = { {l,t}, {x,t}, {r,t}, {r,y}, {r,b}, {x,b}, {l,b}, {l,y} };
            for (int i = 0; i < 8; i++) {
                int px = points[i,0], py = points[i,1]; UIntPtr hit = UIntPtr.Zero;
                bool representable = px >= Int16.MinValue && px <= Int16.MaxValue && py >= Int16.MinValue && py <= Int16.MaxValue;
                bool sent = representable && Send(hwnd, pid, 0x84, new IntPtr((py << 16) | (px & 0xffff)), out hit);
                edges.Add(new { edge = names[i], x = px, y = py, representable = representable, delivered = sent, code = sent ? (object)unchecked((int)hit.ToUInt64()) : null });
            }
            long style = GetWindowLongPtr(hwnd, -16).ToInt64() & 0xffffffffL;
            bool maximized = IsZoomed(hwnd), minimized = IsIconic(hwnd);
            Foreground(handle, pid);
            return new { hwnd = handle, pid = pid, creationTime = AppCreationTime, dpi = GetDpiForWindow(hwnd), window = rect, client = client, monitor = monitor.monitor, workArea = monitor.work, style = style,
                visible = IsWindowVisible(hwnd), maximized = maximized, minimized = minimized, fullScreen = (style & 0x80000000L) != 0 && (style & 0x00cf0000L) == 0,
                diagnostics = new { caption = new { hresult = captionResult, bounds = captionResult == 0 ? (object)caption : null, coordinates = "window-relative physical pixels" },
                    visibleFrame = new { hresult = frameResult, bounds = frameResult == 0 ? (object)visibleFrame : null }, titlebarInfoEx = new { delivered = delivered, raw = titleData },
                    syntheticEdgeHits = edges, qualification = "diagnostics only; no pointer or accessibility acceptance; raw negative title height is not normalized" } };
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
}
'@
function Save-Json($path, $value) {
    $json = ConvertTo-Json -InputObject $value -Depth 12 -Compress
    [IO.File]::WriteAllText("$path.tmp", $json)
    Move-Item -LiteralPath "$path.tmp" -Destination $path -Force
}
$request = Join-Path $Sandbox 'request'
$control = Join-Path $Sandbox 'control'
$failure = $null
$launch = $null
$forced = $false
$remaining = 0
$launcherExit = $null
$appExit = $null
try {
    if (-not [Environment]::Is64BitProcess -or [Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Inspector requires 64-bit Windows' }
    if ((Test-Path -LiteralPath $request) -and [IO.File]::ReadAllText($request) -eq 'stop') { throw 'Stopped before launch' }
    $launch = [ChromeNative]::Start($Launcher, $Sandbox)
    Save-Json (Join-Path $Evidence 'launch.json') $launch
    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    $lastCommand = ''
    $sequence = 0
    $requestedStop = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $command = if (Test-Path -LiteralPath $request) { [IO.File]::ReadAllText($request) } else { '' }
        if ($command -eq 'stop') { $requestedStop = $true; break }
        if ([ChromeNative]::Active() -eq 0) { throw 'Owned application exited before smoke completion' }
        try {
            $ready = [IO.File]::ReadAllText((Join-Path $Sandbox 'ready.json')) | ConvertFrom-Json
            $chrome = [IO.File]::ReadAllText((Join-Path $Sandbox 'chrome.json')) | ConvertFrom-Json
        } catch { Start-Sleep -Milliseconds 100; continue }
        if ($ready.launcherPid -ne $launch.pid -or $ready.pid -ne $chrome.pid -or $ready.mode -ne 'ui') { throw 'Ready/chrome process identity or live-window mode mismatch' }
        $native = [ChromeNative]::Read($chrome.hwnd, $chrome.pid)
        $sequence += 1
        $sample = @{ sequence = $sequence; capturedAt = [DateTime]::UtcNow.ToString('o'); lastCommand = $lastCommand; ready = $ready; chrome = $chrome; native = $native }
        Save-Json (Join-Path $Evidence 'native.latest.json') $sample
        [IO.File]::AppendAllText((Join-Path $Evidence 'native.jsonl'), ((ConvertTo-Json -InputObject $sample -Depth 12 -Compress) + "`n"))
        if ($command -and $command -ne $lastCommand) {
            if ($command -notin @('chrome:maximize', 'chrome:restore', 'chrome:fullscreen-on', 'chrome:fullscreen-off', 'chrome:reload')) { throw 'Unsupported chrome command' }
            [ChromeNative]::Foreground($chrome.hwnd, $chrome.pid)
            [IO.File]::WriteAllText($control, $command)
            $lastCommand = $command
        }
        Start-Sleep -Milliseconds 100
    }
    if (-not $requestedStop) { throw 'Candidate smoke exceeded 180 seconds' }
} catch { $failure = $_.Exception.Message }
finally {
    try {
        [IO.File]::WriteAllText($control, 'stop')
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        while ([ChromeNative]::Active() -gt 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        if ([ChromeNative]::Active() -gt 0) { $forced = $true; [ChromeNative]::KillOwned() }
        $deadline = [DateTime]::UtcNow.AddSeconds(3)
        while ([ChromeNative]::Active() -gt 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        $remaining = [ChromeNative]::Active()
        $launcherExit = [ChromeNative]::LauncherExitCode()
        $appExit = [ChromeNative]::AppExitCode()
        if ($launcherExit -ne 0 -or $appExit -ne 0) { $failure = "$failure; nonzero process exit: launcher=$launcherExit app=$appExit" }
    } catch { $forced = $true; $remaining = -1; $failure = "$failure; cleanup: $($_.Exception.Message)" }
    finally { [ChromeNative]::Close() }
    Save-Json (Join-Path $Evidence 'shutdown.json') @{ forced = $forced; remaining = $remaining; error = $failure; launcher = $launch; appCreationTime = [ChromeNative]::AppCreationTime; launcherExitCode = $launcherExit; appExitCode = $appExit }
}
if ($failure -or $forced -or $remaining -ne 0) { exit 1 }
