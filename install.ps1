# ThinkRail binary installer for Windows -- downloads the single-file thinkrail.exe from the GitHub
# releases, verifies its checksum, and puts it on your PATH. The native counterpart of install.sh
# (macOS/Linux/Git Bash); one script serves both cmd and PowerShell (Windows PowerShell 5.1+).
#
#   powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"
#
# Options are env vars (the one syntax cmd and PowerShell share) -- set before running:
#   THINKRAIL_CHANNEL         stable|nightly   (default: stable)
#   THINKRAIL_VERSION         X.Y.Z|latest     (default: latest)
#   THINKRAIL_PREFIX          DIR              (default: %USERPROFILE%\.local; binary lands at <prefix>\bin\thinkrail.exe)
#   THINKRAIL_NO_MODIFY_PATH  1                don't touch the user PATH; just print advice
#
#   PowerShell:  $env:THINKRAIL_CHANNEL='nightly'; irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex
#   cmd:         set "THINKRAIL_CHANNEL=nightly" && powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"
#
# A saved copy also takes params: .\install.ps1 -Channel nightly -Version 0.2.0 -Prefix D:\tools -NoModifyPath
#
# After install, run `thinkrail`. To update later, run `thinkrail update` (it re-runs this installer for
# you, replacing the running exe); to remove it, run `thinkrail uninstall`.
#
# Kept ASCII-only on purpose: Windows PowerShell 5.1 parses a saved UTF-8 file without BOM as ANSI,
# which would garble any non-ASCII character. Errors `throw` (never `exit`): under `irm | iex` the
# script runs in the caller's session, where `exit` would close an interactive shell; `powershell -c`
# maps an uncaught throw to exit code 1.

param(
    [string]$Channel = $(if ($env:THINKRAIL_CHANNEL) { $env:THINKRAIL_CHANNEL } else { 'stable' }),
    [string]$Version = $(if ($env:THINKRAIL_VERSION) { $env:THINKRAIL_VERSION } else { 'latest' }),
    [string]$Prefix = $(if ($env:THINKRAIL_PREFIX) { $env:THINKRAIL_PREFIX } else { '' }),
    [switch]$NoModifyPath = ($env:THINKRAIL_NO_MODIFY_PATH -eq '1')
)

function Resolve-ThinkRailTag {
    param([string]$Repo, [string]$Channel, [string]$Version)
    if ($Version -ne 'latest') { return 'v' + ($Version -replace '^[vV]', '') }
    $headers = @{ Accept = 'application/vnd.github+json' }
    try {
        if ($Channel -eq 'stable') {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers
            return $release.tag_name
        }
        # `| ForEach-Object { $_ }` flattens deliberately: Invoke-RestMethod can emit a JSON array as a
        # single array object (so a plain @()/foreach would "iterate" once over the whole collection);
        # script-block output enumerates it one level, normalizing every PowerShell version to N items.
        $releases = @(Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=20" -Headers $headers | ForEach-Object { $_ })
        foreach ($release in $releases) {
            if ($release.tag_name -match '^v\d+\.\d+\.\d+-nightly\.\d+$') { return $release.tag_name }
        }
    } catch {
        return $null
    }
    return $null
}

function Get-ThinkRailPersistentPath {
    # Raw (unexpanded) entries of the *persistent* PATH: the per-user value in HKCU\Environment plus the
    # machine value (readable without admin). Deliberately NOT $env:Path -- the live process PATH also
    # carries session-only edits (`$env:Path += ...`, a parent script, an earlier -NoModifyPath run whose
    # advice the user followed by hand), and taking those as proof of installation would skip the
    # registry write and leave thinkrail off PATH in the next terminal. An unreadable hive contributes
    # nothing, which at worst re-adds an entry that was already there.
    $entries = @()
    foreach ($scope in @('User', 'Machine')) {
        $key = $null
        try {
            # Resolved inside the try on purpose: this runs *after* the binary is in place, so no
            # registry mishap may throw out of here and abort an otherwise finished install.
            $key = if ($scope -eq 'User') {
                [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
            } else {
                [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment')
            }
            if ($key) {
                $entries += ([string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)) -split ';'
            }
        } catch {
            # Hive not readable -- treat as "no entries" rather than failing the install.
        } finally {
            if ($key) { $key.Dispose() }
        }
    }
    # `,` keeps an empty result an empty array instead of $null (PowerShell unrolls a bare @() on return).
    return , $entries
}

function Test-ThinkRailOnPath {
    # Is $Dir among these PATH entries (compared unexpanded and %VAR%-expanded, case-insensitively)?
    param([string]$Dir, [string[]]$PathEntries)
    $norm = $Dir.TrimEnd('\')
    foreach ($entry in $PathEntries) {
        if (-not $entry) { continue }
        $e = $entry.Trim().TrimEnd('\')
        if (-not $e) { continue }
        $expanded = [System.Environment]::ExpandEnvironmentVariables($e).TrimEnd('\')
        if (($e -ieq $norm) -or ($expanded -ieq $norm)) { return $true }
    }
    return $false
}

function Add-ThinkRailToUserPath {
    # Append $Dir to the per-user PATH in HKCU\Environment. Deliberately NOT
    # [Environment]::SetEnvironmentVariable('Path', ..., 'User'): that expands %VARS% and rewrites
    # REG_EXPAND_SZ as REG_SZ, clobbering other tools' entries. Returns 'already', 'added', or 'failed'.
    param([string]$Dir)
    $key = $null
    try {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
        if (-not $key) { return 'failed' }
        $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
        $raw = ''
        if (@($key.GetValueNames()) -contains 'Path') {
            $kind = $key.GetValueKind('Path')
            $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        }
        if (Test-ThinkRailOnPath -Dir $Dir -PathEntries (Get-ThinkRailPersistentPath)) { return 'already' }
        $newRaw = if ($raw -and -not $raw.EndsWith(';')) { "$raw;$Dir" } elseif ($raw) { "$raw$Dir" } else { $Dir }
        $key.SetValue('Path', $newRaw, $kind)
        return 'added'
    } catch {
        return 'failed'
    } finally {
        if ($key) { $key.Dispose() }
    }
}

function Send-ThinkRailSettingChange {
    # Broadcast WM_SETTINGCHANGE "Environment" so Explorer re-reads the registry PATH -- terminals
    # opened after this pick it up without a sign-out. Best-effort.
    try {
        if (-not ('ThinkRail.NativeMethods' -as [type])) {
            Add-Type -Namespace ThinkRail -Name NativeMethods -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
        }
        $result = [UIntPtr]::Zero
        # HWND_BROADCAST (0xffff), WM_SETTINGCHANGE (0x1a), SMTO_ABORTIFHUNG (0x2), 5s timeout.
        [void][ThinkRail.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
    } catch {
        # Non-fatal: new terminals see the PATH after the next sign-in regardless.
    }
}

function Install-ThinkRailBinary {
    # Put the verified download at $Dest so that no failure can leave the user without a working exe:
    #   1. Stage the asset *inside* $Dest's own directory first. Crossing volumes (a custom prefix on
    #      another drive) and running out of space happen here -- before anything installed is touched.
    #   2. Swap it in. From here every step is a same-volume rename: it either succeeds or changes
    #      nothing, so it cannot half-fail with the old binary already moved away.
    #   3. Only if $Dest exists and refuses to be overwritten is it locked (thinkrail is running).
    #      Renaming a running exe IS allowed: move it aside, drop the new one in, leave the `.old` for
    #      the next install to clean. If $Dest does *not* exist the first failure was something else
    #      (permissions, AV, full disk) -- rethrow it rather than masking it with a bogus rename.
    #   4. If the swap still fails after the rename-aside, put the old binary back before rethrowing.
    param([string]$Source, [string]$Dest)
    $staged = "$Dest." + [System.IO.Path]::GetRandomFileName() + '.new'
    Move-Item -LiteralPath $Source -Destination $staged -Force
    $aside = $null
    try {
        try {
            Move-Item -LiteralPath $staged -Destination $Dest -Force
        } catch {
            if (-not (Test-Path -LiteralPath $Dest)) { throw }
            $aside = "$Dest." + [System.IO.Path]::GetRandomFileName() + '.old'
            Move-Item -LiteralPath $Dest -Destination $aside -Force
            Move-Item -LiteralPath $staged -Destination $Dest -Force
        }
    } catch {
        if ($aside -and (Test-Path -LiteralPath $aside) -and -not (Test-Path -LiteralPath $Dest)) {
            Move-Item -LiteralPath $aside -Destination $Dest -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Install-ThinkRail {
    param([string]$Channel, [string]$Version, [string]$Prefix, [switch]$NoModifyPath)

    # Function-scoped preferences: `irm | iex` runs in the caller's session, so top-level assignments
    # would leak into an interactive shell. Progress rendering also slows IWR downloads badly on 5.1.
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'

    if ($env:OS -ne 'Windows_NT') {
        throw 'This installer is for Windows. On macOS/Linux use: curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash'
    }

    # Windows PowerShell 5.1 defaults can lack TLS 1.2, which github.com requires. Additive + process-wide.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $repo = if ($env:THINKRAIL_REPO) { $env:THINKRAIL_REPO } else { 'JetBrains/thinkrail' }

    # cmd's `set X=value && ...` embeds the space before && into the value -- trim every input.
    $channel = $Channel.Trim()
    if (@('stable', 'nightly') -notcontains $channel) {
        throw "Invalid channel: $channel (expected: stable or nightly)"
    }
    $version = $Version.Trim()
    if ($version -ne 'latest' -and $version -notmatch '^[vV]?\d+\.\d+\.\d+(-nightly\.\d+)?$') {
        throw "Invalid version: $version (expected: X.Y.Z, X.Y.Z-nightly.N, or latest)"
    }
    $prefix = $Prefix.Trim()
    if (-not $prefix) {
        if (-not $env:USERPROFILE) { throw 'USERPROFILE is not set; pass -Prefix or set THINKRAIL_PREFIX' }
        $prefix = Join-Path $env:USERPROFILE '.local'
    }
    # The prefix is written into the ';'-delimited PATH registry value -- reject its structural chars.
    if ($prefix -match "[;`"`r`n]") {
        throw "Invalid prefix: must not contain ';', double quotes, or newlines"
    }
    if (-not [System.IO.Path]::IsPathRooted($prefix)) {
        throw "Invalid prefix: must be an absolute path (got: $prefix)"
    }

    # Windows-on-ARM has no native build yet; the x64 binary runs under emulation (same as install.sh).
    $assetName = 'thinkrail-windows-x64.exe'

    Write-Host "Resolving latest $channel release for windows/x64 ..."
    $tag = Resolve-ThinkRailTag -Repo $repo -Channel $channel -Version $version
    if (-not $tag) {
        throw "Failed to resolve a $channel release. Has one been published yet?"
    }
    Write-Host "  -> $tag"

    $binDir = Join-Path $prefix 'bin'
    $dest = Join-Path $binDir 'thinkrail.exe'
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('thinkrail-install-' + [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        $assetPath = Join-Path $tmp $assetName
        $sumsPath = Join-Path $tmp 'SHA256SUMS'
        Write-Host "Downloading $assetName (may take a minute) ..."
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/releases/download/$tag/$assetName" -OutFile $assetPath
        Write-Host 'Downloading SHA256SUMS ...'
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/releases/download/$tag/SHA256SUMS" -OutFile $sumsPath

        Write-Host 'Verifying checksum ...'
        $expected = $null
        foreach ($line in (Get-Content -Path $sumsPath)) {
            # sha256sum line format: "<64 hex chars><whitespace>[*]<name>".
            if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$' -and $matches[2].Trim() -eq $assetName) {
                $expected = $matches[1].ToLowerInvariant()
                break
            }
        }
        if (-not $expected) { throw "Checksum entry not found for $assetName in SHA256SUMS" }
        $actual = (Get-FileHash -Algorithm SHA256 -Path $assetPath).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            throw "Checksum mismatch!`n  expected: $expected`n  actual:   $actual"
        }
        Write-Host '  -> ok'

        New-Item -ItemType Directory -Path $binDir -Force | Out-Null
        # Leftovers from earlier installs: `.old` (a renamed-aside running exe) and `.new` (a staged
        # download whose swap was interrupted). Best-effort -- an `.old` may still be running.
        Get-ChildItem -Path $binDir -Filter 'thinkrail.exe.*' -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*.old' -or $_.Name -like '*.new' } |
            Remove-Item -Force -ErrorAction SilentlyContinue
        Install-ThinkRailBinary -Source $assetPath -Dest $dest
        Write-Host "Installed -> $dest"
    } finally {
        Remove-Item -Recurse -Force -Path $tmp -ErrorAction SilentlyContinue
    }

    # Same file + shape install.sh writes; `thinkrail update` reads it (homedir()\.config\thinkrail).
    # Written *after* the PATH section below, because it records whether that section added the entry.
    $configDir = Join-Path $env:USERPROFILE '.config\thinkrail'
    $metaFile = Join-Path $configDir 'install.json'
    $previousMeta = $null
    try {
        if (Test-Path -LiteralPath $metaFile) {
            $previousMeta = Get-Content -LiteralPath $metaFile -Raw | ConvertFrom-Json
        }
    } catch {
        # Unreadable or not JSON -- treat as no previous install (the uninstaller does the same).
    }

    Write-Host ''
    Write-Host "ThinkRail $($tag -replace '^v', '') ($channel) installed."

    $pathAdvice = $null
    $pathStatus = $null
    if ($NoModifyPath) {
        if (Test-ThinkRailOnPath -Dir $binDir -PathEntries (Get-ThinkRailPersistentPath)) {
            Write-Host 'PATH:           already configured'
        } else {
            $pathAdvice = "$binDir (skipped: -NoModifyPath)"
        }
    } else {
        $pathStatus = Add-ThinkRailToUserPath -Dir $binDir
        switch ($pathStatus) {
            'already' { Write-Host 'PATH:           already configured' }
            'added' {
                Send-ThinkRailSettingChange
                Write-Host "PATH:           added $binDir to your user PATH"
                Write-Host '                open a new terminal to pick it up'
            }
            'failed' { $pathAdvice = "$binDir (could not update the registry)" }
        }
        # Persisted -- also make `thinkrail` runnable in *this* session (a saved-copy run in an
        # interactive shell), without duplicating an entry the process PATH already carries.
        if ($pathStatus -ne 'failed' -and -not (Test-ThinkRailOnPath -Dir $binDir -PathEntries ($env:Path -split ';'))) {
            $env:Path = "$env:Path;$binDir"
        }
    }
    # Did *we* put $binDir on the user PATH? `thinkrail uninstall` removes that entry only when this says
    # yes: nothing else in the registry marks it as ours, and a user who already had this dir on PATH for
    # other tools must not lose it. Sticky across re-installs of the same prefix -- an update sees
    # 'already' precisely because an earlier run of ours added it, and that ownership must not decay.
    $pathEntryAdded = $pathStatus -eq 'added'
    if (-not $pathEntryAdded -and $previousMeta -and $previousMeta.path_entry_added -eq $true) {
        $before = ([string]$previousMeta.prefix).Replace('/', '\').TrimEnd('\')
        if ($before -and ($before -ieq $prefix.Replace('/', '\').TrimEnd('\'))) { $pathEntryAdded = $true }
    }

    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    $meta = [ordered]@{
        channel          = $channel
        version          = ($tag -replace '^v', '')
        tag              = $tag
        prefix           = $prefix
        path_entry_added = $pathEntryAdded
        installed_at     = ((Get-Date).ToUniversalTime().ToString('s') + 'Z')
    }
    # WriteAllText writes UTF-8 without BOM (PS 5.1's Set-Content -Encoding UTF8 adds one, which
    # breaks the JSON.parse in `thinkrail update`).
    [System.IO.File]::WriteAllText($metaFile, ($meta | ConvertTo-Json))

    if ($pathAdvice) { Write-Host "Add to PATH:    $pathAdvice" }
    Write-Host 'Run:            thinkrail'
    Write-Host 'Update later:   thinkrail update'
    Write-Host 'Uninstall:      thinkrail uninstall'
}

Install-ThinkRail -Channel $Channel -Version $Version -Prefix $Prefix -NoModifyPath:$NoModifyPath
