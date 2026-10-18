import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MockupDocument } from "./mockup.ts";

export const MOCKUP_FILE_CSP =
	"default-src 'none'; img-src file: data: blob:; style-src 'unsafe-inline' file:; font-src file: data:; form-action 'none'";

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const HTTP_EQUIV_META = /<meta\b[^>]*\bhttp-equiv\b[^>]*>/gi;

export function mockupFileHtml(document: MockupDocument, cwd: string): string {
	const base = pathToFileURL(cwd.endsWith("/") ? cwd : `${cwd}/`).href;
	const prelude =
		`<!doctype html><html><head><meta charset="utf-8">` +
		`<meta http-equiv="Content-Security-Policy" content="${MOCKUP_FILE_CSP}">` +
		`<base href="${escapeHtml(base)}">` +
		`<meta name="viewport" content="width=device-width, initial-scale=1">` +
		`<title>${escapeHtml(document.label)}</title></head>`;
	return `${prelude}${document.html.replace(HTTP_EQUIV_META, "")}`;
}

export function mockupFileUrl(path: string): string {
	return pathToFileURL(path).href;
}

export function mockupFileDir(): string {
	return join(tmpdir(), "pi-visualize");
}

export function writeMockupFile(document: MockupDocument, cwd: string): string {
	const html = mockupFileHtml(document, cwd);
	const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);
	const dir = mockupFileDir();
	const path = join(dir, `${hash}.html`);
	if (!existsSync(path)) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, html, "utf8");
	}
	return path;
}
