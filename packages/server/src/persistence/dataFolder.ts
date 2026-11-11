import { mkdirSync, readdirSync, type Stats, statSync } from "node:fs";
import { join } from "node:path";

const DATA_FOLDER_POLL_MS = 1_000;

export function listDataFolder(dir: string, include: (name: string) => boolean): string[] {
	try {
		return readdirSync(dir)
			.filter((name) => !name.startsWith(".") && include(name))
			.sort();
	} catch {
		return [];
	}
}

export function fileStatSignature(stat: Stats): string {
	return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function folderSignature(dir: string, names: readonly string[]): string {
	return names
		.map((name) => {
			try {
				return `${name}:${fileStatSignature(statSync(join(dir, name)))}`;
			} catch {
				return `${name}:gone`;
			}
		})
		.join("\n");
}

export interface DataFolderWatchOptions {
	dir: string;
	list: (dir: string) => string[];
	onChange: () => void;
	onCreateFailed: () => void;
	intervalMs?: number;
}

export function watchDataFolder({
	dir,
	list,
	onChange,
	onCreateFailed,
	intervalMs = DATA_FOLDER_POLL_MS,
}: DataFolderWatchOptions): () => void {
	try {
		mkdirSync(dir, { recursive: true });
	} catch {
		onCreateFailed();
	}
	let signature = folderSignature(dir, list(dir));
	const timer = setInterval(() => {
		const next = folderSignature(dir, list(dir));
		if (next === signature) return;
		signature = next;
		onChange();
	}, intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}
