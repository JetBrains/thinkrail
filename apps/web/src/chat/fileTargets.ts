import { isAbsolutePath, normalizePath, projectRelativePath } from "@/lib";

const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

export function hasUriScheme(value: string): boolean {
	return URI_SCHEME.test(value);
}

export function mentionLookup(query: string): { dir: string; prefix: string } {
	const path = normalizePath(query);
	const slash = path.lastIndexOf("/");
	return slash >= 0
		? { dir: path.slice(0, slash), prefix: path.slice(slash + 1).toLowerCase() }
		: { dir: "", prefix: path.toLowerCase() };
}

export function isWindowsAbsolutePath(value: string): boolean {
	return WINDOWS_ABSOLUTE_PATH.test(value);
}

export function workspaceFileTarget(
	path: string,
	workspaceRoot?: string | undefined,
): string | null {
	const candidate = path.trim();
	if (!candidate) return null;
	if (!isAbsolutePath(candidate) && hasUriScheme(candidate)) return null;
	const relative = projectRelativePath(candidate, workspaceRoot);
	if (!relative || isAbsolutePath(relative) || relative === ".." || relative.startsWith("../")) {
		return null;
	}
	return relative;
}
