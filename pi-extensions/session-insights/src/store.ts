import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const NAME = /^[a-z][a-z0-9-]*\.json$/;

/**
 * Small JSON documents in the embedder's private data folder (hidden findings, the user's labels and
 * notes). A missing or unreadable document reads as `parse(undefined)`; writes to one document are
 * serialized and land atomically (temporary file, then rename). Once `signal` aborts, an update rejects
 * with its reason and writes nothing, the previous document kept. Never holds message text.
 */
export class JsonStore {
	private readonly dir: string;
	private readonly signal: AbortSignal | undefined;
	private readonly writes = new Map<string, Promise<unknown>>();

	constructor(dir: string, options: { signal?: AbortSignal } = {}) {
		this.dir = dir;
		this.signal = options.signal;
	}

	private path(name: string): string {
		if (!NAME.test(name)) throw new Error(`Invalid store document name: ${name}`);
		return join(this.dir, name);
	}

	async read<T>(name: string, parse: (value: unknown) => T): Promise<T> {
		const path = this.path(name);
		await this.writes.get(name)?.catch(() => {});
		try {
			return parse(JSON.parse(await readFile(path, "utf8")));
		} catch {
			return parse(undefined);
		}
	}

	/**
	 * Applies `change` to the current document and writes `serialize` of the result; returns the result.
	 * A `change` that returns `current` itself writes nothing.
	 */
	update<T>(
		name: string,
		parse: (value: unknown) => T,
		change: (current: T) => T,
		serialize: (value: T) => unknown = (value) => value,
	): Promise<T> {
		const path = this.path(name);
		const previous = this.writes.get(name) ?? Promise.resolve();
		const next = previous
			.catch(() => {})
			.then(async () => {
				let current: T;
				try {
					current = parse(JSON.parse(await readFile(path, "utf8")));
				} catch {
					current = parse(undefined);
				}
				const value = change(current);
				if (value === current) return value;
				const { signal } = this;
				signal?.throwIfAborted();
				await mkdir(this.dir, { recursive: true });
				const temporary = `${path}.${randomUUID()}.tmp`;
				try {
					signal?.throwIfAborted();
					await writeFile(temporary, `${JSON.stringify(serialize(value))}\n`, "utf8");
					signal?.throwIfAborted();
					await rename(temporary, path);
				} catch (error) {
					await rm(temporary, { force: true });
					throw error;
				}
				return value;
			});
		this.writes.set(name, next);
		const settle = () => {
			if (this.writes.get(name) === next) this.writes.delete(name);
		};
		next.then(settle, settle);
		return next;
	}
}
