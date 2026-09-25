import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtStore } from "@thinkrail/ext";

type Data = Record<string, unknown>;

const isData = (value: unknown): value is Data =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readData = async (file: string): Promise<Data> => {
	if (!existsSync(file)) return {};
	const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
	return isData(parsed) ? parsed : {};
};

export const createExtStore = ({ dir, name }: { dir: string; name: string }): ExtStore => {
	const file = join(dir, `${name}.json`);
	let data: Promise<Data> | undefined;
	let writes: Promise<void> = Promise.resolve();
	const load = () => {
		data ??= readData(file).catch((error: unknown) => {
			data = undefined;
			throw error;
		});
		return data;
	};
	return {
		async get<T>(key: string) {
			return (await load())[key] as T | undefined;
		},
		set(key, value) {
			const serialized = JSON.stringify(value);
			const write = writes.then(async () => {
				const current = await load();
				if (serialized === undefined) delete current[key];
				else current[key] = JSON.parse(serialized);
				await mkdir(dir, { recursive: true });
				const tmp = `${file}.${process.pid}.tmp`;
				await writeFile(tmp, JSON.stringify(current, null, 2));
				await rename(tmp, file);
			});
			writes = write.catch(() => {});
			return write;
		},
	};
};

export const createDryStore = (live: ExtStore): ExtStore => {
	const overlay = new Map<string, unknown>();
	return {
		async get<T>(key: string) {
			return (overlay.has(key) ? overlay.get(key) : await live.get(key)) as T | undefined;
		},
		async set(key, value) {
			const serialized = JSON.stringify(value);
			overlay.set(key, serialized === undefined ? undefined : JSON.parse(serialized));
		},
	};
};
