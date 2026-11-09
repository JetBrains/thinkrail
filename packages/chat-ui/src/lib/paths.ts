export function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function hasWindowsDriveRoot(path: string): boolean {
	return /^[A-Za-z]:\//.test(normalizePath(path));
}

export function isAbsolutePath(path: string): boolean {
	const normalized = normalizePath(path);
	return normalized.startsWith("/") || hasWindowsDriveRoot(normalized);
}

export function fileName(path: string): string {
	const parts = normalizePath(path).split("/").filter(Boolean);
	return parts.at(-1) ?? path;
}

function trimTrailingSlashes(path: string): string {
	return path === "/" || /^[A-Za-z]:\/$/.test(path) ? path : path.replace(/\/+$/, "");
}

function canonicalPosixPath(path: string): string {
	const normalized = normalizePath(path);
	const drive = /^[A-Za-z]:\//.exec(normalized)?.[0];
	const absolute = normalized.startsWith("/") || drive !== undefined;
	const body = drive ? normalized.slice(drive.length) : normalized.replace(/^\/+/, "");
	const segments: string[] = [];
	for (const segment of body.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			const previous = segments.at(-1);
			if (previous && previous !== "..") segments.pop();
			else if (!absolute) segments.push(segment);
			continue;
		}
		segments.push(segment);
	}
	const prefix = drive ?? (absolute ? "/" : "");
	return `${prefix}${segments.join("/")}`;
}

function rootRelative(canonical: string, workspaceRoot: string): string | null {
	const root = trimTrailingSlashes(canonicalPosixPath(workspaceRoot));
	const ignoreCase = hasWindowsDriveRoot(canonical) && hasWindowsDriveRoot(root);
	const comparableCanonical = ignoreCase ? canonical.toLowerCase() : canonical;
	const comparableRoot = ignoreCase ? root.toLowerCase() : root;
	const rootPrefix = comparableRoot.endsWith("/") ? comparableRoot : `${comparableRoot}/`;
	if (
		!comparableRoot ||
		(comparableCanonical !== comparableRoot && !comparableCanonical.startsWith(rootPrefix))
	) {
		return null;
	}
	return canonical.slice(root.length).replace(/^\/+/, "");
}

export function projectRelativePath(path: string, workspaceRoot?: string | undefined): string {
	const canonical = canonicalPosixPath(path);
	if (!canonical || !isAbsolutePath(canonical)) return canonical;
	const relative = workspaceRoot ? rootRelative(canonical, workspaceRoot) : null;
	if (relative === null) return canonical;
	return relative || fileName(canonical);
}

export function pathWithinRoot(path: string, root: string): string | null {
	const canonical = canonicalPosixPath(path);
	return isAbsolutePath(canonical) && isAbsolutePath(root) ? rootRelative(canonical, root) : null;
}

export function joinWorkspacePath(worktreePath: string, path: string): string {
	if (!worktreePath || path.startsWith("/") || hasWindowsDriveRoot(path)) return path;
	const windows = /^(?:[A-Za-z]:\\|\\\\)/.test(worktreePath);
	const separator = windows ? "\\" : "/";
	const root = worktreePath.endsWith(separator) ? worktreePath : `${worktreePath}${separator}`;
	return `${root}${windows ? path.replaceAll("/", "\\") : path}`;
}
