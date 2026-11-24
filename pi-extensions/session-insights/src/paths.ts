import { posix, win32 } from "node:path";

/** A drive letter (`C:`, `C:\`) or a UNC share (`\\server\share`): a path written on Windows. */
const WINDOWS_PATH = /^(?:[A-Za-z]:(?:[\\/]|$)|\\\\[^\\/])/;
const DRIVE_RELATIVE = /^[A-Za-z]:(?![\\/])/;
const ROOT_RELATIVE = /^[\\/](?![\\/])/;

export function isWindowsPath(path: string): boolean {
	return WINDOWS_PATH.test(path);
}

/**
 * How one session's paths resolve: against its folder, in that folder's own flavor (`path.win32` for a
 * Windows folder, else `path.posix`; never the host's), case-insensitively on Windows.
 */
export interface WorkspacePaths {
	/** The session's folder, normalized, without a trailing separator; `null` when the header has none. */
	root: string | null;
	windows: boolean;
	/** Windows: the first spelling of each case-folded key, so one file keeps one key in a session. */
	spellings: Map<string, string>;
}

export function workspacePaths(cwd: string | null): WorkspacePaths {
	const windows = cwd !== null && isWindowsPath(cwd);
	const root = cwd
		? windows
			? win32.normalize(cwd).replace(/\\+$/, "")
			: posix.normalize(cwd).replace(/\/+$/, "")
		: null;
	return { root, windows, spellings: new Map() };
}

/** A file path as a session's matrix keys it: `relative` (POSIX) inside the session's folder, else `null`. */
export interface ResolvedPath {
	relative: string | null;
	/** The path as written, normalized in the session's flavor (Windows keys keep their first spelling). */
	written: string;
}

function canonical(paths: WorkspacePaths, key: string): string {
	if (!paths.windows) return key;
	const folded = key.toLowerCase();
	const first = paths.spellings.get(folded);
	if (first !== undefined) return first;
	paths.spellings.set(folded, key);
	return key;
}

function windowsAbsolute(path: string, root: string | null): string | null {
	const base = root === null ? null : `${root}\\`;
	if (DRIVE_RELATIVE.test(path)) {
		const drive = path.slice(0, 2);
		return base?.toLowerCase().startsWith(drive.toLowerCase())
			? win32.join(base, path.slice(2))
			: win32.normalize(`${drive}\\${path.slice(2)}`);
	}
	if (ROOT_RELATIVE.test(path))
		return base ? win32.normalize(`${win32.parse(base).root}${path.slice(1)}`) : null;
	if (win32.isAbsolute(path)) return win32.normalize(path);
	return base ? win32.join(base, path) : null;
}

function insideOf(relative: string, separator: string): string | null {
	const normal = relative.replace(/^\.(?:[\\/]|$)/, "");
	if (!normal || normal === ".") return null;
	return normal === ".." || normal.startsWith(`..${separator}`) ? null : normal;
}

/**
 * `raw` resolved against the session's folder: inside it, its path relative to the folder with `/`
 * separators (a `..` that leaves the folder is outside); a home-relative path (`~`) is always outside.
 */
export function resolvePath(raw: string, paths: WorkspacePaths): ResolvedPath {
	const { root } = paths;
	if (!paths.windows) {
		if (raw.startsWith("/")) {
			const absolute = posix.normalize(raw);
			const relative =
				root && absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : "";
			return { relative: insideOf(relative, "/"), written: raw };
		}
		return {
			relative: raw.startsWith("~") ? null : insideOf(posix.normalize(raw), "/"),
			written: raw,
		};
	}
	if (raw.startsWith("~")) return { relative: null, written: canonical(paths, raw) };
	const absolute = windowsAbsolute(raw, root);
	if (absolute === null) {
		const relative = insideOf(win32.normalize(raw), "\\");
		return relative
			? { relative: canonical(paths, relative.replaceAll("\\", "/")), written: raw }
			: { relative: null, written: canonical(paths, win32.normalize(raw)) };
	}
	const prefix = root === null ? null : `${root}\\`;
	if (
		prefix &&
		absolute.length > prefix.length &&
		absolute.toLowerCase().startsWith(prefix.toLowerCase())
	)
		return {
			relative: canonical(paths, absolute.slice(prefix.length).replaceAll("\\", "/")),
			written: absolute,
		};
	return { relative: null, written: canonical(paths, absolute) };
}

/** `path` with Windows separators as `/` in a Windows session, for matching a file name pattern. */
export function slashed(path: string, paths: WorkspacePaths): string {
	return paths.windows ? path.replaceAll("\\", "/") : path;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATH_CHAR = String.raw`[^\\/\s"'<>|:*?]`;

/**
 * Rewrites `folder` (a session's cwd) as `to` in a text: as written on POSIX; on Windows in any case and
 * with either separator, the path after it turned to `/` separators.
 */
export function folderRewriter(folder: string, to: string): (text: string) => string {
	if (!folder) return (text) => text;
	if (!isWindowsPath(folder)) return (text) => text.split(folder).join(to);
	const segments = folder
		.split(/[\\/]+/)
		.filter(Boolean)
		.map(escapeRegExp);
	const prefix = folder.startsWith("\\\\") ? String.raw`[\\/]{2}` : "";
	const pattern = new RegExp(
		`${prefix}${segments.join(String.raw`[\\/]+`)}(?!${PATH_CHAR})((?:[\\\\/]+${PATH_CHAR}*)*)`,
		"gi",
	);
	return (text) =>
		text.replace(pattern, (_, tail: string) => `${to}${tail.replace(/[\\/]+/g, "/")}`);
}
