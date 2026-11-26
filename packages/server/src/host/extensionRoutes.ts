import {
	type InstalledExtensionRecord,
	installedExtensions,
	resolveExtensionAsset,
} from "../extensions";

const IMMUTABLE = "public, max-age=31536000, immutable";

function plain(status: number, text: string, headers?: Record<string, string>): Response {
	return new Response(text, { status, ...(headers ? { headers } : {}) });
}

export function serveExtensionAsset(
	req: Request,
	pathname: string,
	records: readonly InstalledExtensionRecord[] = installedExtensions()?.records() ?? [],
): Response {
	if (req.method !== "GET" && req.method !== "HEAD") {
		return plain(405, "method not allowed", { Allow: "GET, HEAD" });
	}
	const asset = resolveExtensionAsset(records, pathname);
	if (!asset) return plain(404, "not found");
	return new Response(Bun.file(asset.path), {
		headers: {
			"Content-Type": asset.contentType,
			"Cache-Control": IMMUTABLE,
			"X-Content-Type-Options": "nosniff",
		},
	});
}
