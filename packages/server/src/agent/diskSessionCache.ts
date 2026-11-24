import { type BigIntStats, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface DiskSessionSnapshot {
	readonly entries: readonly SessionEntry[];
	readonly title: string;
	readonly firstPrompt?: string;
	readonly lastActivityAt: number;
}

interface CachedSnapshot {
	stamp: BigIntStats;
	snapshot: DiskSessionSnapshot;
	chars: number;
}

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
	return (
		a.dev === b.dev &&
		a.ino === b.ino &&
		a.size === b.size &&
		a.mtimeNs === b.mtimeNs &&
		a.ctimeNs === b.ctimeNs &&
		a.mode === b.mode
	);
}

export class DiskSessionCache {
	private readonly cache = new Map<string, CachedSnapshot>();
	private chars = 0;
	private readonly maxEntries: number;
	private readonly maxChars: number;

	constructor(maxEntries = 2_048, maxChars = 8 * 1024 * 1024) {
		this.maxEntries = maxEntries;
		this.maxChars = maxChars;
	}

	read(path: string, load: () => DiskSessionSnapshot): DiskSessionSnapshot {
		const key = resolve(path);
		try {
			const before = statSync(key, { bigint: true });
			const cached = this.cache.get(key);
			if (cached && sameFile(cached.stamp, before)) {
				this.cache.delete(key);
				this.cache.set(key, cached);
				return cached.snapshot;
			}
			this.forget(key);
			const snapshot = load();
			const after = statSync(key, { bigint: true });
			if (!sameFile(before, after)) return snapshot;
			const chars = JSON.stringify(snapshot).length;
			if (chars > this.maxChars || this.maxEntries < 1) return snapshot;
			this.cache.set(key, { stamp: after, snapshot, chars });
			this.chars += chars;
			for (const oldest of this.cache.keys()) {
				if (this.cache.size <= this.maxEntries && this.chars <= this.maxChars) break;
				this.forget(oldest);
			}
			return snapshot;
		} catch (error) {
			this.forget(key);
			throw error;
		}
	}

	forget(path: string): void {
		const key = resolve(path);
		const cached = this.cache.get(key);
		if (!cached) return;
		this.cache.delete(key);
		this.chars -= cached.chars;
	}

	retainDirectory(directory: string, paths: ReadonlySet<string>): void {
		const key = resolve(directory);
		for (const path of this.cache.keys()) {
			if (dirname(path) === key && !paths.has(path)) this.forget(path);
		}
	}

	clear(): void {
		this.cache.clear();
		this.chars = 0;
	}
}
