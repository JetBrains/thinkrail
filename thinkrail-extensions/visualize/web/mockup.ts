import type { AssetResolver } from "@thinkrail/extension-api/web";
import { parseHtmlDocument, prepareHtmlPreviewDocument } from "@thinkrail/ui/html-frame";

export type MockupViewport = "desktop" | "tablet" | "phone";

export const MOCKUP_VIEWPORTS: readonly MockupViewport[] = ["desktop", "tablet", "phone"];

export const VIEWPORT_WIDTHS: Record<MockupViewport, number> = {
	desktop: 1280,
	tablet: 768,
	phone: 390,
};

export const MIN_MOCKUP_HEIGHT = 120;
export const MAX_MOCKUP_HEIGHT = 4000;

export interface MockupDocumentView {
	label: string;
	html: string;
}

export function parseViewport(value: unknown): MockupViewport {
	return value === "tablet" || value === "phone" ? value : "desktop";
}

export function parseMockupDocuments(args: Record<string, unknown>): MockupDocumentView[] {
	const text = (value: unknown) =>
		typeof value === "string" && value.trim() !== "" ? value : null;
	const html = text(args.html);
	if (html !== null) return [{ label: "Mockup", html }];
	const before = text(args.before);
	const after = text(args.after);
	if (before !== null && after !== null) {
		return [
			{ label: "Before", html: before },
			{ label: "After", html: after },
		];
	}
	return [];
}

export function mockupScale(containerWidth: number, frameWidth: number): number {
	if (containerWidth <= 0 || frameWidth <= 0) return 1;
	return Math.min(1, containerWidth / frameWidth);
}

export function clampMockupHeight(height: number): number {
	return Math.min(MAX_MOCKUP_HEIGHT, Math.max(MIN_MOCKUP_HEIGHT, Math.ceil(height)));
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;

export function isWorkspaceAssetRef(ref: string): boolean {
	const value = ref.trim();
	return (
		value !== "" &&
		!SCHEME.test(value) &&
		!value.startsWith("/") &&
		!value.startsWith("\\") &&
		!value.startsWith("#")
	);
}

export function normalizeAssetPath(ref: string): string | null {
	const clean = ref.trim().split(/[?#]/, 1)[0] ?? "";
	const parts: string[] = [];
	for (const part of clean.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (parts.length === 0) return null;
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	if (parts.length === 0) return null;
	try {
		return parts.map((part) => decodeURIComponent(part)).join("/");
	} catch {
		return null;
	}
}

function srcsetRefs(value: string): string[] {
	return value
		.split(",")
		.map((candidate) => candidate.trim().split(/\s+/, 1)[0] ?? "")
		.filter((ref) => ref !== "");
}

function cssRefs(css: string): string[] {
	return [...css.matchAll(CSS_URL)].map((match) => match[2] ?? "");
}

function replaceCssRefs(css: string, urls: ReadonlyMap<string, string>): string {
	return css.replace(CSS_URL, (whole, _quote: string, ref: string) => {
		const url = urls.get(ref);
		return url ? `url("${url}")` : whole;
	});
}

function replaceSrcset(value: string, urls: ReadonlyMap<string, string>): string {
	return value
		.split(",")
		.map((candidate) => {
			const trimmed = candidate.trim();
			const [ref = "", ...descriptor] = trimmed.split(/\s+/);
			const url = urls.get(ref);
			return url ? [url, ...descriptor].join(" ") : trimmed;
		})
		.join(", ");
}

function urlAttributes(element: Element): readonly string[] {
	return element.localName.toLowerCase() === "image"
		? ["src", "poster", "href"]
		: ["src", "poster"];
}

function assetElements(document: Document): Element[] {
	return Array.from(document.querySelectorAll("[src], [srcset], [poster], [style], image[href]"));
}

export function collectAssetRefs(document: Document): string[] {
	const refs = new Set<string>();
	const add = (ref: string) => {
		if (isWorkspaceAssetRef(ref)) refs.add(ref.trim());
	};
	for (const element of assetElements(document)) {
		for (const name of urlAttributes(element)) {
			const value = element.getAttribute(name);
			if (value !== null) add(value);
		}
		const srcset = element.getAttribute("srcset");
		if (srcset !== null) for (const ref of srcsetRefs(srcset)) add(ref);
		const style = element.getAttribute("style");
		if (style !== null) for (const ref of cssRefs(style)) add(ref);
	}
	for (const style of Array.from(document.querySelectorAll("style"))) {
		for (const ref of cssRefs(style.textContent ?? "")) add(ref);
	}
	return [...refs];
}

export function applyAssetUrls(document: Document, urls: ReadonlyMap<string, string>): void {
	if (urls.size === 0) return;
	for (const element of assetElements(document)) {
		for (const name of urlAttributes(element)) {
			const value = element.getAttribute(name);
			const url = value === null ? undefined : urls.get(value.trim());
			if (url) element.setAttribute(name, url);
		}
		const srcset = element.getAttribute("srcset");
		if (srcset !== null) element.setAttribute("srcset", replaceSrcset(srcset, urls));
		const style = element.getAttribute("style");
		if (style !== null) element.setAttribute("style", replaceCssRefs(style, urls));
	}
	for (const style of Array.from(document.querySelectorAll("style"))) {
		style.textContent = replaceCssRefs(style.textContent ?? "", urls);
	}
}

export async function resolveAssetUrls(
	refs: readonly string[],
	resolveAsset: AssetResolver,
): Promise<Map<string, string>> {
	const entries = await Promise.all(
		refs.map(async (ref) => {
			const path = normalizeAssetPath(ref);
			if (path === null) return null;
			const url = await resolveAsset(path).catch(() => null);
			return url && /^data:/i.test(url) ? ([ref, url] as const) : null;
		}),
	);
	return new Map(entries.filter((entry) => entry !== null));
}

export async function buildMockupDocumentWithAssets(
	html: string,
	resolveAsset: AssetResolver | undefined,
): Promise<string> {
	const document = parseHtmlDocument(html);
	if (resolveAsset) {
		const urls = await resolveAssetUrls(collectAssetRefs(document), resolveAsset);
		applyAssetUrls(document, urls);
	}
	return prepareHtmlPreviewDocument(document, { keepFormControls: true });
}
