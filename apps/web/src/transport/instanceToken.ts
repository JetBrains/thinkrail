import { INSTANCE_TOKEN_META, INSTANCE_TOKEN_PARAM } from "@thinkrail/contracts";
import { hostUrl } from "./fonts";

let cached: string | null | undefined;

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

export function withInstanceToken(url: string): string {
	const token = instanceToken();
	if (token === null) return url;
	return `${url}${url.includes("?") ? "&" : "?"}${INSTANCE_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

export function authorizedHostUrl(path: string): string {
	return withInstanceToken(hostUrl(path));
}

export function setInstanceTokenForTests(value: string | null | undefined): void {
	cached = value;
}
