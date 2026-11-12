import type { ResourceMeta } from "@thinkrail/contracts";
import type { ResourceContent } from "./types";

export const PENDING_TEXT_META: ResourceMeta = { hash: null, byteLength: null, text: true };

export function resourceContent(
	text: string,
	meta: ResourceMeta | undefined,
	url: () => string | null,
): ResourceContent {
	if (!meta) return { kind: "text", text, hash: "" };
	if (meta.hash === null || meta.byteLength === null) return { kind: "absent" };
	if (meta.text) return { kind: "text", text, hash: meta.hash };
	const bytes = url();
	if (bytes === null) return { kind: "absent" };
	return { kind: "bytes", url: bytes, hash: meta.hash, byteLength: meta.byteLength };
}

export function diffResourceMeta(original: ResourceMeta, modified: ResourceMeta): ResourceMeta {
	const present = [original, modified].filter((side) => side.hash !== null);
	const representative = modified.hash !== null ? modified : (present[0] ?? PENDING_TEXT_META);
	return { ...representative, text: present.every((side) => side.text) };
}
