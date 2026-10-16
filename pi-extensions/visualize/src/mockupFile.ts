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

export function mockupFileHtml(document: MockupDocument, cwd: string): string {
	const base = pathToFileURL(cwd.endsWith("/") ? cwd : `${cwd}/`).href;
	const head =
		`<meta charset="utf-8"><base href="${escapeHtml(base)}">` +
		`<meta http-equiv="Content-Security-Policy" content="${MOCKUP_FILE_CSP}">` +
		`<meta name="viewport" content="width=device-width, initial-scale=1">`;
	const title = `<title>${escapeHtml(document.label)}</title>`;
	const headTag = /<head\b[^>]*>/i.exec(document.html);
	if (headTag) {
		const at = headTag.index + headTag[0].length;
		const hasTitle = /<title\b/i.test(document.html);
		return `${document.html.slice(0, at)}${head}${hasTitle ? "" : title}${document.html.slice(at)}`;
	}
	const htmlTag = /<html\b[^>]*>/i.exec(document.html);
	if (htmlTag) {
		const at = htmlTag.index + htmlTag[0].length;
		return `${document.html.slice(0, at)}<head>${head}${title}</head>${document.html.slice(at)}`;
	}
	return `<!doctype html><html><head>${head}${title}</head><body>${document.html}</body></html>`;
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
