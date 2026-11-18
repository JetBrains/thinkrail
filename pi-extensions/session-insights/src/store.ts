import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const NAME = /^[a-z][a-z0-9-]*\.json$/;

/**
 * Small JSON documents in the embedder's private data folder (hidden findings, the user's labels and
 * notes). A missing or unreadable document reads as `parse(undefined)`; writes to one document are
 * serialized and land atomically (temporary file, then rename). Never holds message text.
 */
export class JsonStore {
	private readonly dir: string;
	private readonly writes = new Map<string, Promise<unknown>>();

	constructor(dir: string) {
		this.dir = dir;
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
				await mkdir(this.dir, { recursive: true });
				const temporary = `${path}.${process.pid}.tmp`;
				await writeFile(temporary, `${JSON.stringify(serialize(value))}\n`, "utf8");
				await rename(temporary, path);
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
