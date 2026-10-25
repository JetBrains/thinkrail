export type DoneMerge = { state: "done"; html: string; before: string };

export const MERGE_CACHE_SIZE = 16;
export const MERGE_CACHE_TEXT = 4 * 1024 * 1024;
const merges = new Map<string, DoneMerge>();
let retainedText = 0;

const mergeSize = (merge: DoneMerge) => merge.html.length + merge.before.length;

function textHash(text: string, seed: number): number {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		h1 = Math.imul(h1 ^ code, 2654435761);
		h2 = Math.imul(h2 ^ code, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function mergeKey(before: string, after: string): string {
	return `${textHash(before, 0)}:${before.length}:${textHash(after, 1)}:${after.length}`;
}

export function peekMerge(key: string): DoneMerge | undefined {
	return merges.get(key);
}

export function rememberMerge(key: string, merge: DoneMerge): void {
	const previous = merges.get(key);
	if (previous) {
		merges.delete(key);
		retainedText -= mergeSize(previous);
	}
	merges.set(key, merge);
	retainedText += mergeSize(merge);
	for (const [oldest, entry] of merges) {
		if (merges.size <= 1 || (merges.size <= MERGE_CACHE_SIZE && retainedText <= MERGE_CACHE_TEXT)) {
			break;
		}
		merges.delete(oldest);
		retainedText -= mergeSize(entry);
	}
}
