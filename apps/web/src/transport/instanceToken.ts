import { INSTANCE_TOKEN_META } from "@thinkrail/contracts";

let cached: string | null | undefined;

/**
 * The per-instance credential the host embedded in the served page. Read once from the `<meta>` tag;
 * a cross-origin page cannot reach this document, so the token never leaves the trusted client. The
 * transport appends it to the `/ws`, `/files` and `/blob` requests the host now requires.
 */
export function instanceToken(): string | null {
	if (cached === undefined) {
		const content =
			typeof document === "undefined"
				? null
				: document.querySelector(`meta[name="${INSTANCE_TOKEN_META}"]`)?.getAttribute("content");
		cached = content && content.length > 0 ? content : null;
	}
	return cached;
}

/** Test-only override for the cached token. */
export function setInstanceTokenForTests(value: string | null | undefined): void {
	cached = value;
}
