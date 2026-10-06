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
			const inFlight = pending.get(path);
			if (inFlight) return inFlight;
			const promise = read()
				.then((fresh) => {
					const next = { ...fresh, loadedTick, loadedTarget };
					content.set(path, next);
					return next;
				})
				.finally(() => {
					if (pending.get(path) === promise) pending.delete(path);
				});
			pending.set(path, promise);
			return promise;
		},
	};
}
