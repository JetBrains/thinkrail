import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Host access gate for the HTTP/WS surface. The host is unauthenticated by default (local,
 * same-origin use); once an access token is configured — the remote "add project by QR" mode — the
 * guarded endpoints (`/ws`, `/files`, `/blob`) require it. See `SPEC.md`.
 */

const AUTH_QUERY_PARAM = "token";
const BEARER = /^Bearer\s+(.+)$/i;

/** Reads a token from `Authorization: Bearer …` or the `?token=` query param (WS/`<img>` can't set headers). */
export function readAccessToken(req: Request): string | null {
	const header = req.headers.get("authorization");
	if (header) {
		const match = BEARER.exec(header.trim());
		if (match?.[1]) return match[1];
	}
	const query = new URL(req.url).searchParams.get(AUTH_QUERY_PARAM);
	return query ? query : null;
}

/** Constant-time comparison over SHA-256 digests, so neither value nor its length leaks via timing. */
export function tokensMatch(a: string, b: string): boolean {
	const da = createHash("sha256").update(a).digest();
	const db = createHash("sha256").update(b).digest();
	return timingSafeEqual(da, db);
}

/**
 * Guards a request against the configured access token. Returns a 401 `Response` to reject, or
 * `null` to allow. When `expected` is undefined the host is unguarded and every request is allowed.
 */
export function guardAccess(req: Request, expected: string | undefined): Response | null {
	if (!expected) return null;
	const provided = readAccessToken(req);
	if (provided !== null && tokensMatch(provided, expected)) return null;
	return new Response("unauthorized", { status: 401 });
}
