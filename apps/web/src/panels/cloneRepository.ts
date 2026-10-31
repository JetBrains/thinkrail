export function repositoryFolderName(rawUrl: string): string {
	const url = rawUrl.trim();
	let path: string;
	try {
		path = url.includes("://") ? new URL(url).pathname : url.slice(url.indexOf(":") + 1);
		path = decodeURIComponent(path);
	} catch {
		return "";
	}
	return (path.replace(/\/+$/, "").split("/").pop() ?? "")
		.replace(/\.git$/i, "")
		.replace(/[/\\<>:"|?*\p{Cc}]/gu, "-")
		.replace(/^[. ]+|[. ]+$/g, "");
}

export function cloneDepth(raw: string): number | undefined | null {
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	if (!/^\d+$/.test(trimmed)) return null;
	const depth = Number(trimmed);
	return Number.isInteger(depth) && depth >= 1 && depth <= 2_147_483_647 ? depth : null;
}
