import { existsSync, readdirSync } from "node:fs";
import { extname } from "node:path";

const CONTENT_TYPES = new Map([
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".gif", "image/gif"],
	[".webp", "image/webp"],
	[".svg", "image/svg+xml"],
]);

export function imageContentType(file: string): string | undefined {
	return CONTENT_TYPES.get(extname(file).toLowerCase());
}

export function postImageFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory).filter((file) => imageContentType(file) !== undefined);
}
