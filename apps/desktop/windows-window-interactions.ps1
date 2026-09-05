param([Parameter(Mandatory = $true)][int]$ProcessId)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class ThinkRailWindowProbe {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowLongPtrW(IntPtr hwnd, int index);

    [DllImport("user32.dll")]
    public static extern IntPtr GetSystemMenu(IntPtr hwnd, bool revert);

    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    public static extern bool PostMessageW(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);

    public static RECT ReadRect(IntPtr hwnd) {
        RECT rect;
        if (!GetWindowRect(hwnd, out rect)) throw new InvalidOperationException("GetWindowRect failed");
        return rect;
    }

    public static void Reset(IntPtr hwnd) {
        if (!SetWindowPos(hwnd, IntPtr.Zero, 200, 150, 800, 600, 0x14)) {
            throw new InvalidOperationException("SetWindowPos failed");
        }
    }

    public static void Drag(IntPtr hwnd, int hitTest, int startX, int startY, int endX, int endY) {
        SetForegroundWindow(hwnd);
        SetCursorPos(startX, startY);
        Thread.Sleep(75);
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        ReleaseCapture();
        int packed = (startY << 16) | (startX & 0xffff);
        if (!PostMessageW(hwnd, 0x00A1, (IntPtr)hitTest, (IntPtr)packed)) {
            mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
            throw new InvalidOperationException("WM_NCLBUTTONDOWN failed");
        }
        for (int step = 1; step <= 20; step++) {
            int x = startX + ((endX - startX) * step / 20);
            int y = startY + ((endY - startY) * step / 20);
            SetCursorPos(x, y);
            mouse_event(0x0001, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(20);
        }
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(250);
    }
}
"@

$deadline = [DateTime]::UtcNow.AddSeconds(10)
$window = [IntPtr]::Zero
while ($window -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline) {
    try {
        $window = (Get-Process -Id $ProcessId -ErrorAction Stop).MainWindowHandle
    } catch {
        $window = [IntPtr]::Zero
    }
    if ($window -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 50 }
}
if ($window -eq [IntPtr]::Zero) { throw "Could not find the ThinkRail window" }

$style = [ThinkRailWindowProbe]::GetWindowLongPtrW($window, -16).ToInt64()
if (($style -band 0x000F0000) -ne 0x000F0000) {
    throw "The Windows frame is missing resize, system-menu, minimize, or maximize capabilities"
}
if ([ThinkRailWindowProbe]::GetSystemMenu($window, $false) -eq [IntPtr]::Zero) {
    throw "The Windows system menu is unavailable"
}

function Wait-ForRect([scriptblock]$Accept, [string]$Failure) {
    $limit = [DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $limit) {
        $rect = [ThinkRailWindowProbe]::ReadRect($window)
        if (& $Accept $rect) { return $rect }
        Start-Sleep -Milliseconds 25
    }
    throw $Failure
}

function Reset-Window {
    [ThinkRailWindowProbe]::ShowWindow($window, 9) | Out-Null
    [ThinkRailWindowProbe]::Reset($window)
    return Wait-ForRect {
        param($rect)
        [Math]::Abs($rect.Left - 200) -le 3 -and
        [Math]::Abs($rect.Top - 150) -le 3 -and
        [Math]::Abs(($rect.Right - $rect.Left) - 800) -le 3 -and
        [Math]::Abs(($rect.Bottom - $rect.Top) - 600) -le 3
    } "The Windows frame did not reset"
}

$beforeMove = Reset-Window
[ThinkRailWindowProbe]::Drag($window, 2, $beforeMove.Left + 300, $beforeMove.Top + 24, $beforeMove.Left + 380, $beforeMove.Top + 84)
Wait-ForRect {
    param($rect)
    $rect.Left - $beforeMove.Left -ge 40 -and $rect.Top - $beforeMove.Top -ge 30
} "The Windows application titlebar did not move the native window" | Out-Null

$edges = @(
    @{ Hit = 13; X = 1; Y = 1; DX = -30; DY = -20; West = $true; North = $true },
    @{ Hit = 12; X = 400; Y = 1; DX = 0; DY = -20; North = $true },
    @{ Hit = 14; X = 799; Y = 1; DX = 30; DY = -20; East = $true; North = $true },
    @{ Hit = 10; X = 1; Y = 300; DX = -30; DY = 0; West = $true },
    @{ Hit = 11; X = 799; Y = 300; DX = 30; DY = 0; East = $true },
    @{ Hit = 16; X = 1; Y = 599; DX = -30; DY = 20; West = $true; South = $true },
    @{ Hit = 15; X = 400; Y = 599; DX = 0; DY = 20; South = $true },
    @{ Hit = 17; X = 799; Y = 599; DX = 30; DY = 20; East = $true; South = $true }
)

foreach ($edge in $edges) {
    $before = Reset-Window
    $startX = $before.Left + $edge.X
    $startY = $before.Top + $edge.Y
    [ThinkRailWindowProbe]::Drag($window, $edge.Hit, $startX, $startY, $startX + $edge.DX, $startY + $edge.DY)
    Wait-ForRect {
        param($rect)
        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
        (-not $edge.West -or ($rect.Left -lt $before.Left - 10 -and $width -gt 810)) -and
        (-not $edge.East -or $width -gt 810) -and
        (-not $edge.North -or ($rect.Top -lt $before.Top - 10 -and $height -gt 610)) -and
        (-not $edge.South -or $height -gt 610)
    } "The Windows frame did not resize from native edge $($edge.Hit)" | Out-Null
}

$beforeSnap = Reset-Window
$screenCenter = [ThinkRailWindowProbe]::GetSystemMetrics(0) / 2
[ThinkRailWindowProbe]::Drag($window, 2, $beforeSnap.Left + 300, $beforeSnap.Top + 24, $screenCenter, 0)
$snapDeadline = [DateTime]::UtcNow.AddSeconds(5)
while (-not [ThinkRailWindowProbe]::IsZoomed($window) -and [DateTime]::UtcNow -lt $snapDeadline) {
    Start-Sleep -Milliseconds 25
}
if (-not [ThinkRailWindowProbe]::IsZoomed($window)) { throw "Windows top-edge snap did not maximize the window" }
[ThinkRailWindowProbe]::ShowWindow($window, 9) | Out-Null
Reset-Window | Out-Null
