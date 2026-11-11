import { INSTANCE_TOKEN_META } from "@thinkrail/contracts";

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

export function setInstanceTokenForTests(value: string | null | undefined): void {
	cached = value;
}
