export const CACHED_DIFF_TEXT = 4 * 1024 * 1024;
export const CACHED_DIFFS = 64;

interface Entry<T> {
	key: readonly unknown[];
	size: number;
	value: T;
}

const retainedText = (key: readonly unknown[]) =>
	key.reduce<number>((size, part) => size + (typeof part === "string" ? part.length : 0), 0);

export function createDiffCache<T>(): (key: readonly unknown[], compute: () => T) => T {
	const entries: Entry<T>[] = [];
	let retained = 0;
	return (key, compute) => {
		const index = entries.findIndex(
			(entry) =>
				entry.key.length === key.length &&
				entry.key.every((part, position) => Object.is(part, key[position])),
		);
		const found = index === -1 ? undefined : entries.splice(index, 1)[0];
		const entry = found ?? { key, size: retainedText(key), value: compute() };
		if (!found) retained += entry.size;
		entries.unshift(entry);
		while (entries.length > 1 && (entries.length > CACHED_DIFFS || retained > CACHED_DIFF_TEXT)) {
			retained -= entries.pop()?.size ?? 0;
		}
		return entry.value;
	};
}
