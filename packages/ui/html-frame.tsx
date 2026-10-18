import { useEffect, useEffectEvent, useRef } from "react";

export const HTML_PREVIEW_CSP =
	"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; child-src 'none'";

const REMOVED_ELEMENTS = new Set(["script", "base", "link", "object", "embed", "iframe", "area"]);
const FORM_CONTROLS = new Set(["form", "input", "button", "select", "textarea"]);
const REMOVED_ATTRIBUTES = new Set(["ping", "formaction", "srcdoc", "xlink:href", "autofocus"]);

export interface HtmlSanitizeOptions {
	keepFormControls?: boolean;
}

function isDataUrl(value: string): boolean {
	return /^data:/i.test(value.trim());
}

function removeElement(element: Element, options: HtmlSanitizeOptions): boolean {
	const name = element.localName.toLowerCase();
	return (
		REMOVED_ELEMENTS.has(name) ||
		(!options.keepFormControls && FORM_CONTROLS.has(name)) ||
		(name === "meta" && element.getAttribute("http-equiv") !== null)
	);
}

function sanitizeElement(element: Element, options: HtmlSanitizeOptions): void {
	for (const child of Array.from(element.children)) {
		if (removeElement(child, options)) child.remove();
		else sanitizeElement(child, options);
	}

	const name = element.localName.toLowerCase();
	if (name === "a") {
		const href = Array.from(element.attributes).find((attribute) =>
			["href", "xlink:href"].includes(attribute.name.toLowerCase()),
		)?.value;
		if (href !== undefined) {
			element.setAttribute("data-href", href);
			element.setAttribute("title", href);
		}
	}

	for (const attribute of Array.from(element.attributes)) {
		const attributeName = attribute.name.toLowerCase();
		if (
			attributeName.startsWith("on") ||
			REMOVED_ATTRIBUTES.has(attributeName) ||
			(name === "a" && attributeName === "href") ||
			((attributeName === "src" || attributeName === "href") && !isDataUrl(attribute.value))
		) {
			element.removeAttribute(attribute.name);
		}
	}
}

export function sanitizeHtmlDocument(document: Document, options: HtmlSanitizeOptions = {}): void {
	sanitizeElement(document.documentElement, options);
}

function installPreviewPolicy(document: Document): void {
	const charset = document.createElement("meta");
	charset.setAttribute("charset", "utf-8");
	const csp = document.createElement("meta");
	csp.setAttribute("http-equiv", "Content-Security-Policy");
	csp.setAttribute("content", HTML_PREVIEW_CSP);
	document.head.prepend(charset, csp);
}

export function prepareHtmlPreviewDocument(
	document: Document,
	options: HtmlSanitizeOptions = {},
): string {
	sanitizeHtmlDocument(document, options);
	installPreviewPolicy(document);
	return `<!doctype html>${document.documentElement.outerHTML}`;
}

export function parseHtmlDocument(source: string): Document {
	return new DOMParser().parseFromString(source, "text/html");
}

export function buildHtmlPreviewDocument(
	source: string,
	options: HtmlSanitizeOptions = {},
): string {
	return prepareHtmlPreviewDocument(parseHtmlDocument(source), options);
}

export interface HtmlContentSize {
	width: number;
	height: number;
}

export interface HtmlFrameProps {
	title: string;
	document: string;
	className?: string | undefined;
	onContentSize?: ((size: HtmlContentSize) => void) | undefined;
}

const DEFAULT_FRAME_CLASS = "h-full min-h-[360px] w-full border-0 bg-container-workspace-bg";

export function HtmlFrame({ title, document, className, onContentSize }: HtmlFrameProps) {
	const frame = useRef<HTMLIFrameElement>(null);
	const measured = onContentSize !== undefined;
	const report = useEffectEvent((size: HtmlContentSize) => onContentSize?.(size));

	useEffect(() => {
		const element = frame.current;
		if (!measured || !element) return;
		let observer: ResizeObserver | undefined;
		const measure = () => {
			const root = element.contentDocument?.documentElement;
			if (!root) return;
			report({ width: root.scrollWidth, height: root.offsetHeight });
		};
		const attach = () => {
			observer?.disconnect();
			const root = element.contentDocument?.documentElement;
			if (!root) return;
			measure();
			observer = new ResizeObserver(measure);
			observer.observe(root);
		};
		element.addEventListener("load", attach);
		if (element.contentDocument?.readyState === "complete") attach();
		return () => {
			element.removeEventListener("load", attach);
			observer?.disconnect();
		};
	}, [measured]);

	return (
		<iframe
			ref={frame}
			title={title}
			sandbox={measured ? "allow-same-origin" : ""}
			srcDoc={document}
			className={className ?? DEFAULT_FRAME_CLASS}
		/>
	);
}
