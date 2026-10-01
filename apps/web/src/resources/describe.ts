import type { GitDiffScope, ResourceMeta } from "@thinkrail/contracts";
import { normalizePath } from "@/lib";
import type { ResourceDescriptor } from "./types";

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
	ts: "typescript",
	tsx: "tsx",
	mts: "typescript",
	cts: "typescript",
	js: "javascript",
	jsx: "jsx",
	mjs: "javascript",
	cjs: "javascript",
	json: "json",
	jsonc: "json",
	css: "css",
	html: "html",
	htm: "html",
	md: "markdown",
	mdx: "markdown",
	py: "python",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	yaml: "yaml",
	yml: "yaml",
	diff: "diff",
	patch: "diff",
};

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	txt: "text/plain",
	md: "text/markdown",
	mdx: "text/markdown",
	html: "text/html",
	htm: "text/html",
	css: "text/css",
	js: "text/javascript",
	mjs: "text/javascript",
	cjs: "text/javascript",
	ts: "text/typescript",
	tsx: "text/typescript",
	mts: "text/typescript",
	cts: "text/typescript",
	jsx: "text/javascript",
	json: "application/json",
	jsonc: "application/json",
	yaml: "application/yaml",
	yml: "application/yaml",
	csv: "text/csv",
	tsv: "text/tab-separated-values",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
	svg: "image/svg+xml",
	pdf: "application/pdf",
};

function extension(path: string): string {
	const name = normalizePath(path).split("/").at(-1) ?? path;
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function inferredMime(path: string): string | undefined {
	return MIME_BY_EXTENSION[extension(path)];
}

export function describeResource(
	workspaceId: string,
	path: string,
	meta: ResourceMeta,
	scope?: GitDiffScope,
): ResourceDescriptor {
	const ext = extension(path);
	const mime = meta.mime ?? inferredMime(path);
	return {
		workspaceId,
		path: normalizePath(path),
		text: meta.text,
		...(mime ? { mime } : {}),
		...(meta.text && LANGUAGE_BY_EXTENSION[ext] ? { language: LANGUAGE_BY_EXTENSION[ext] } : {}),
		...(meta.byteLength === null ? {} : { byteLength: meta.byteLength }),
		...(scope ? { scope } : {}),
	};
}
