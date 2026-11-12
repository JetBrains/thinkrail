export function canonicalWorkspacePath(path: string): string {
	const segments: string[] = [];
	for (const segment of path.replaceAll("\\", "/").split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === ".." && segments.length > 0 && segments.at(-1) !== "..") segments.pop();
		else segments.push(segment);
	}
	return segments.join("/");
}
