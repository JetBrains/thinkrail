---
id: submodule-server-fonts
type: submodule-design
status: active
title: fonts — user font files and the host's installed fonts
parent: module-server
depends-on: [module-contracts]
references: [submodule-server-themes, submodule-server-dialog]
tags: [ui, fonts, public-surface-checked]
---

## Responsibility

Reads, stores and watches the user's font files in `<dataDir>/fonts/` (the global data dir only, never a
workspace, like [[submodule-server-themes]]) and asks the operating system's font service which families
are installed. It reports what each file declares; which font a role uses is an `AppConfig` field the
client resolves, and the client confirms rendering and monospacing by measurement.

## Boundary

- **Owns:** creating the folder on start (and on reveal or upload — never from the poller); scanning
  `*.ttf|*.otf|*.woff|*.woff2` (extensions case-insensitive); the per-file status; the caps (50 MiB per
  file, 128 files — the rest report `too-many`); the in-house sfnt reader; what its folder watch counts as a change (persistence's `watchDataFolder` polls); storing an
  upload; the installed-font query.
- **Public surface (barrel):** `fontsDir`, `readUserFonts`, `watchUserFonts`, `saveUserFont`,
  `fontFileKind`, `listInstalledFonts`, `MAX_FONT_FILE_BYTES`, `MAX_FONT_FILES`.
- `fontFileKind(name)` is the one name rule for the scan and the `/fonts/` route ([[submodule-server-host]]):
  `font`, `collection` (`.ttc`/`.otc`), or `null` for a dot-prefixed name, `..`, a path separator, a control
  character, `<>:"|?*`, or any other extension — so every URL the list hands out is one the route serves.
- `readUserFonts(dir?)` → `{ dir, files }`, sorted by name: `{ fileName, ok: true, url, face }` or
  `{ fileName, ok: false, error, detail? }` with `error` one of `too-large`, `too-many`,
  `unsupported-collection` (by extension or a `ttcf` header), `invalid-font` (the reader's untranslated
  `detail`), `unreadable` (the OS detail). `url` is `/fonts/<encoded name>?v=<version>`, the version a hash
  of the file's inode, size, mtime and ctime. Parsed entries are memoized per path under that version, so a
  list re-parses only changed files.
- `saveUserFont(name, body, dir?)` → that file's entry: streams the body into a dot-prefixed temp file in
  the folder, aborting past 50 MiB (`too-large`); refuses a new name when the folder already lists 128 files
  (`too-many`; replacing an existing name is allowed), and checks again right before the rename, so
  concurrent uploads cannot overfill it; parses the temp file and only then renames it over the target, so
  a rejected upload never touches the existing file; the temp file is always removed.
- `watchUserFonts({ dir?, onChange, intervalMs? })` → stop function; a nudge when the scanned names'
  signature (name, inode, size, mtime, ctime) changes — the poll [[submodule-server-locales]] explains.
- `listInstalledFonts()` → `{ families: [{ name, monospaceHint }] }`, asked of the OS on every call (no
  cache), through `subprocess`'s bounded runner (15 s budget, `windowsHide`).
- **Wire** (gated by `FONTS_PROTOCOL_VERSION`): `fonts.list` → `readUserFonts()`; `fonts.installed` →
  `listInstalledFonts()`; `fonts.reveal` → `Ack`; `fonts.changed` is an invalidation nudge, not data. `host`
  composes all of them, the reveal with `editors`' file-manager reveal, and owns the HTTP route.
- `testFonts.ts` is a test-only builder of minimal TTF/OTF/WOFF/WOFF2 fonts and a `ttcf` header, outside
  the barrel; tests import it relatively, `host`'s route test included.
- **Allowed deps:** `persistence` (`dataDir`, the data-folder helpers), `log`, `subprocess` (`runBounded`),
  `@thinkrail/shared/codedError`, `node:zlib` (Bun built-in) — no font-parsing or compression package.
- **Forbidden:** HTTP, `settings` (the chosen fonts), `agent`, any workspace path.

## The sfnt reader

`readFontFace(bytes)` reads only the table directory and the `name`, `OS/2`, `post` and `fvar` tables of a
TrueType/OpenType font (`0x00010000`, `true`, `OTTO`), WOFF (per-table zlib) or WOFF2 (one Brotli stream; the
directory's known-tag index, UIntBase128 lengths, and a `transformLength` for transformed `glyf`/`loca`
(version 0) and other tables with a non-zero version — offsets are the running sum of each table's stored
length). npm font parsers weigh 0.5–5.6 MB for these four tables.

- **Family:** name ID 16, else 1; **subfamily:** 17, else 2. Records rank Windows (platform 3, UTF-16BE)
  US English first, then any Windows language, then Unicode (platform 0), then Mac Roman. Control
  characters are dropped; a family `isFontFamilyName` rejects is `invalid-font`, so every listed family can
  be stored as a `FontFamilyRef`.
- **Style:** italic when `fsSelection` has ITALIC or OBLIQUE, `post.italicAngle ≠ 0`, or the subfamily
  says Italic/Oblique. **Weight:** the `fvar` `wght` axis range, else `usWeightClass` (outside 1–1000 or
  without `OS/2`: 400). **Monospace:** `post.isFixedPitch`, or PANOSE Latin Text (family kind 2) with
  proportion 9 — other kinds use that digit differently.
- Every read is bounds-checked: truncated or garbage input throws `FontFormatError` (`invalid-font`, or
  `unsupported-collection` for a `ttcf` header or flavor). Decompression is capped at the declared lengths
  and 128 MiB, so a 50 MiB file cannot expand without bound.

## Installed fonts

- **Linux:** `fc-list -f '%{family[0]}\t%{spacing}\n'`; a family is hinted monospace when any face reports
  spacing 100 (mono) or 110 (charcell). Dual (90) is not: `DroidSansJapanese.ttf` reports it under the
  proportional family "Droid Sans".
- **macOS:** `osascript -l JavaScript` over `NSFontManager.availableFontFamilies`; a family is hinted
  monospace when a member's traits carry `NSFixedPitchFontMask` (0x400). The script's value is printed on
  stdout (JXA's `console.log` writes stderr).
- **Windows:** `powershell.exe -NoProfile -NonInteractive -EncodedCommand` over
  `System.Drawing.Text.InstalledFontCollection`, no monospace hint. The script passes the list as
  `-InputObject`, so one family still prints as a JSON array, and escapes every non-ASCII character as
  `\uXXXX`, so the output is ASCII whatever the console code page (redirected output uses the OEM code
  page, which would mangle non-Latin names).
- Names are trimmed; empty, `.`-prefixed (macOS system-private) and `isFontFamilyName`-rejected names are
  dropped; duplicates merge case-insensitively, OR-ing their hints; the list sorts case-insensitively.
- Any failure — the tool missing, a non-zero exit, the timeout, unreadable output — throws a `CodedError`
  `INSTALLED_FONTS_UNAVAILABLE` whose untranslated message names the tool; the picker offers Retry.
- **Fixture override (dev/e2e):** when `THINKRAIL_INSTALLED_FONTS` is set it names a JSON file, re-read on
  every call before any native tool, like `THINKRAIL_PICK_DIR` ([[submodule-server-dialog]]):
  `[{ "name": …, "monospaceHint": … }]` is the list, `{ "error": "<message>" }` throws that failure, and an
  unreadable file fails too — never a silent fall-through to the host's real fonts.

## Get right

- A broken file never blocks the others; a file past the caps is reported without being read.
- The URL version includes ctime and inode, not only size and mtime: `cp -p` preserves mtime, and a
  same-sized replacement would otherwise keep a URL the browser has cached.
- Upload temp files live in the folder itself, so the rename is atomic, and are dot-prefixed, so neither
  the scan nor the poller ever sees a partial upload; starting the watcher sweeps any a crash left behind.
- The OS font service, not a scan of font folders, is the installed list: its family names are the ones the
  webview resolves `font-family` against, and it sees fonts a scan would miss — fontconfig's configured
  directories, macOS on-demand fonts, font-manager activations. A folder scan was rejected for that miss.
- The macOS and Windows queries are covered on Linux only through their output parsers and argv; the
  commands themselves run only on those hosts.
