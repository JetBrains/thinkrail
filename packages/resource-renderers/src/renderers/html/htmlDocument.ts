import { cspHash } from "./sha256";

export const HTML_PREVIEW_CSP =
	"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; child-src 'none'";

const REMOVED_ELEMENTS = new Set([
	"script",
	"base",
	"link",
	"object",
	"embed",
	"iframe",
	"form",
	"input",
	"button",
	"select",
	"textarea",
	"area",
]);
const REMOVED_ATTRIBUTES = new Set(["ping", "formaction", "srcdoc", "xlink:href"]);

function isDataUrl(value: string): boolean {
	return /^data:/i.test(value.trim());
}

function removeElement(element: Element): boolean {
	const name = element.localName.toLowerCase();
	return (
		REMOVED_ELEMENTS.has(name) || (name === "meta" && element.getAttribute("http-equiv") !== null)
	);
}

function sanitizeElement(element: Element): void {
	for (const child of Array.from(element.children)) {
		if (removeElement(child)) child.remove();
		else sanitizeElement(child);
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

export function sanitizeHtmlDocument(document: Document): void {
	sanitizeElement(document.documentElement);
}

function installPreviewPolicy(document: Document): void {
	const charset = document.createElement("meta");
	charset.setAttribute("charset", "utf-8");
	const csp = document.createElement("meta");
	csp.setAttribute("http-equiv", "Content-Security-Policy");
	csp.setAttribute("content", HTML_PREVIEW_CSP);
	document.head.prepend(charset, csp);
}

export function prepareHtmlPreviewDocument(document: Document): string {
	sanitizeHtmlDocument(document);
	installPreviewPolicy(document);
	return `<!doctype html>${document.documentElement.outerHTML}`;
}

export function buildHtmlPreviewDocument(source: string): string {
	const document = new DOMParser().parseFromString(source, "text/html");
	return prepareHtmlPreviewDocument(document);
}

export const HTML_INTERACTIVE_FRAME_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'";

export function interactiveDocumentPolicy(scriptHashes: readonly string[]): string {
	return `default-src 'none'; script-src ${[...new Set(scriptHashes)].join(" ")} 'unsafe-hashes'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'`;
}

export const SCROLL_BRIDGE_SOURCE = "thinkrail-html-scroll";

export const WEBRTC_GLOBALS = [
	"RTCPeerConnection",
	"webkitRTCPeerConnection",
	"mozRTCPeerConnection",
];

export const WEBRTC_NEUTER = `{for (const name of ${JSON.stringify(WEBRTC_GLOBALS)}) if (name in window) Object.defineProperty(window, name, { value: undefined, configurable: false, writable: false });}\n`;

function frameBridge(token: string): string {
	return `(() => {
document.currentScript?.remove();
${WEBRTC_NEUTER}const host = parent;
const source = ${JSON.stringify(SCROLL_BRIDGE_SOURCE)};
const token = ${JSON.stringify(token)};
const scroller = () => document.scrollingElement || document.documentElement;
const post = (kind) => host.postMessage({ source, kind, token, top: scroller().scrollTop, left: scroller().scrollLeft }, "*");
addEventListener("scroll", () => post("scroll"), { passive: true });
addEventListener("load", () => post("loaded"));
addEventListener("pagehide", () => post("left"));
addEventListener("message", (event) => {
const data = event.data;
if (event.source !== host || !data || data.source !== source || data.kind !== "scrollTo") return;
scroller().scrollTo({ top: Number(data.top) || 0, left: Number(data.left) || 0, behavior: "instant" });
post("applied");
});
})();`;
}

const JAVASCRIPT_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:java|ecma|j|live)script)$/;

function runsAsScript(element: Element): boolean {
	if (element.localName.toLowerCase() !== "script" || element.getAttribute("src") !== null)
		return false;
	const essence = (element.getAttribute("type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	return JAVASCRIPT_TYPE.test(essence);
}

function neutralizeInteractive(element: Element, hashes: string[]): void {
	for (const child of Array.from(element.children)) {
		const name = child.localName.toLowerCase();
		if (
			name === "base" ||
			name === "link" ||
			(name === "meta" && child.getAttribute("http-equiv") !== null)
		) {
			child.remove();
			continue;
		}
		neutralizeInteractive(child, hashes);
	}
	if (runsAsScript(element)) {
		const source = `${WEBRTC_NEUTER}${element.textContent ?? ""}`;
		element.textContent = source;
		hashes.push(cspHash(source));
	}
	for (const attribute of Array.from(element.attributes)) {
		if (!attribute.name.toLowerCase().startsWith("on")) continue;
		const source = `${WEBRTC_NEUTER}${attribute.value}`;
		element.setAttribute(attribute.name, source);
		hashes.push(cspHash(source));
	}
	if (!["a", "area"].includes(element.localName.toLowerCase())) return;
	const href = element.getAttribute("href");
	if (href === null || href.trim().startsWith("#")) return;
	element.removeAttribute("href");
	element.setAttribute("data-href", href);
	element.setAttribute("title", href);
}

export interface InteractiveHtmlDocument {
	document: string;
	token: string;
}

export function prepareInteractiveHtmlDocument(document: Document, token: string): string {
	const hashes: string[] = [];
	neutralizeInteractive(document.documentElement, hashes);
	const bridgeSource = frameBridge(token);
	hashes.unshift(cspHash(bridgeSource));
	const charset = document.createElement("meta");
	charset.setAttribute("charset", "utf-8");
	const csp = document.createElement("meta");
	csp.setAttribute("http-equiv", "Content-Security-Policy");
	csp.setAttribute("content", interactiveDocumentPolicy(hashes));
	const noPrefetch = document.createElement("meta");
	noPrefetch.setAttribute("http-equiv", "x-dns-prefetch-control");
	noPrefetch.setAttribute("content", "off");
	const bridge = document.createElement("script");
	bridge.textContent = bridgeSource;
	document.head.prepend(charset, csp, noPrefetch, bridge);
	return `<!doctype html>${document.documentElement.outerHTML}`;
}

export function interactiveToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildInteractiveHtmlDocument(source: string): InteractiveHtmlDocument {
	const parsed = new DOMParser().parseFromString(source, "text/html");
	const token = interactiveToken();
	return { document: prepareInteractiveHtmlDocument(parsed, token), token };
}
