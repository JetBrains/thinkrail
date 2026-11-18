import { matchesGlob } from "../../registry";

let interactiveGlobs: readonly string[] = [];

export function setInteractiveHtmlGlobs(globs: readonly string[]): void {
	interactiveGlobs = globs;
}

export function isInteractiveHtmlPath(path: string): boolean {
	return interactiveGlobs.some((pattern) => matchesGlob(path, pattern));
}
