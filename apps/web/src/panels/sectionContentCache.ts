import type { ResourceMeta } from "@thinkrail/contracts";

export interface SectionContent {
	original: string;
	modified: string;
	meta: { original: ResourceMeta; modified: ResourceMeta } | undefined;
	originalOid: string | null | undefined;
	loadedTick: number;
	loadedTarget: string;
}

type DiffFileResult = Omit<SectionContent, "loadedTick" | "loadedTarget">;

export interface SectionContentCache {
	get(path: string): SectionContent | undefined;
	set(path: string, content: SectionContent): void;
	load(
		path: string,
		read: () => Promise<DiffFileResult>,
		loadedTick: number,
		loadedTarget: string,
	): Promise<SectionContent>;
}

export function createSectionContentCache(): SectionContentCache {
	const content = new Map<string, SectionContent>();
	const pending = new Map<string, Promise<SectionContent>>();
	return {
		get: (path) => content.get(path),
		set: (path, next) => {
			content.set(path, next);
		},
		load(path, read, loadedTick, loadedTarget) {
			const key = `${loadedTarget}\u0000${path}`;
			const inFlight = pending.get(key);
			if (inFlight) return inFlight;
			const promise = read()
				.then((fresh) => {
					const next = { ...fresh, loadedTick, loadedTarget };
					content.set(path, next);
					return next;
				})
				.finally(() => {
					if (pending.get(key) === promise) pending.delete(key);
				});
			pending.set(key, promise);
			return promise;
		},
	};
}
