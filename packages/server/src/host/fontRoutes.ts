import { statSync } from "node:fs";
import { join } from "node:path";
import {
	USER_FONT_UPLOAD_HEADER,
	USER_FONTS_ROUTE,
	type UserFontFile,
	type UserFontFileErrorCode,
} from "@thinkrail/contracts";
import { fontFileKind, fontsDir, MAX_FONT_FILE_BYTES, saveUserFont } from "../fonts";

const ALLOWED_METHODS = "GET, PUT";
const ERROR_STATUS: Record<UserFontFileErrorCode, number> = {
	"too-large": 413,
	"too-many": 409,
	"unsupported-collection": 422,
	"invalid-font": 422,
	unreadable: 500,
};

function plain(status: number, text: string, headers?: Record<string, string>): Response {
	return new Response(text, { status, ...(headers ? { headers } : {}) });
}

function entryResponse(entry: UserFontFile): Response {
	return Response.json(entry, { status: entry.ok ? 200 : ERROR_STATUS[entry.error] });
}

function requestedName(pathname: string): string | null {
	try {
		return decodeURIComponent(pathname.slice(USER_FONTS_ROUTE.length));
	} catch {
		return null;
	}
}

function serveFont(fileName: string | null): Response {
	if (fileName === null || fontFileKind(fileName) !== "font") return plain(404, "not found");
	const path = join(fontsDir(), fileName);
	try {
		if (!statSync(path).isFile()) return plain(404, "not found");
	} catch {
		return plain(404, "not found");
	}
	return new Response(Bun.file(path), {
		headers: { "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
	});
}

async function acceptFont(req: Request, fileName: string | null): Promise<Response> {
	if (req.headers.get(USER_FONT_UPLOAD_HEADER.name) !== USER_FONT_UPLOAD_HEADER.value) {
		return plain(403, "forbidden");
	}
	const kind = fileName === null ? null : fontFileKind(fileName);
	if (fileName === null || kind === null) return plain(400, "not a font file name");
	if (kind === "collection") {
		return entryResponse({ fileName, ok: false, error: "unsupported-collection" });
	}
	if (Number(req.headers.get("Content-Length") ?? 0) > MAX_FONT_FILE_BYTES) {
		return entryResponse({ fileName, ok: false, error: "too-large" });
	}
	return entryResponse(await saveUserFont(fileName, req.body));
}

export async function serveUserFonts(req: Request, pathname: string): Promise<Response> {
	const fileName = requestedName(pathname);
	if (req.method === "GET") return serveFont(fileName);
	if (req.method === "PUT") return acceptFont(req, fileName);
	return plain(405, "method not allowed", { Allow: ALLOWED_METHODS });
}
