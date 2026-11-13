import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SavedVisualization, VisualizationSaver } from "@thinkrail/pi-visualize";

const SLUG_MAX = 48;
const MAX_ATTEMPTS = 99;

function two(value: number): string {
	return String(value).padStart(2, "0");
}

export function visualizationStamp(date: Date): string {
	const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`;
	return `${day}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

export function visualizationSlug(params: SavedVisualization["params"]): string {
	const slug = (params.title ?? "")
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.slice(0, SLUG_MAX)
		.replace(/^-+|-+$/g, "");
	return slug || params.type;
}

export function visualizationSaver(
	dir: string,
	now: () => Date = () => new Date(),
): VisualizationSaver {
	return async ({ params, markdown, cwd }) => {
		const folder = resolve(cwd, dir);
		await mkdir(folder, { recursive: true });
		const base = `${visualizationStamp(now())}-${visualizationSlug(params)}`;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			const name = attempt === 1 ? `${base}.md` : `${base}-${attempt}.md`;
			try {
				await writeFile(join(folder, name), `${markdown}\n`, { flag: "wx" });
				return `${dir}${name}`;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
		return undefined;
	};
}
