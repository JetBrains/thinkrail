import { frameBootstrap, frameNonce } from "./frameMessages";

export const HTML_PREVIEW_CSP =
	"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; child-src 'none'";

export const SCRIPTED_HTML_CSP =
	"default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

interface SanitizePolicy {
	removes(element: Element, name: string): boolean;
	keepsHandlers: boolean;
	keepsUrl(value: string, element: string, attribute: string): boolean;
}

const STATIC_REMOVED = new Set([
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
const SCRIPTED_REMOVED = new Set([
	"base",
	"object",
	"embed",
	"iframe",
	"frame",
	"frameset",
	"portal",
]);
const REMOVED_ATTRIBUTES = new Set(["ping", "formaction", "srcdoc"]);
const URL_ATTRIBUTES = new Set(["src", "href", "xlink:href"]);

const isDataUrl = (value: string) => /^data:/i.test(value.trim());
const isFragment = (value: string) => value.trim().startsWith("#");
const isSandboxedUrl = (value: string) => /^(data:|blob:|https:)/i.test(value.trim());
const isHttpEquivMeta = (element: Element, name: string) =>
	name === "meta" && element.getAttribute("http-equiv") !== null;

function isRemoteStylesheet(element: Element): boolean {
	const rel = (element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
	return rel.includes("stylesheet") && /^https:/i.test((element.getAttribute("href") ?? "").trim());
}

const STATIC_POLICY: SanitizePolicy = {
	removes: (element, name) => STATIC_REMOVED.has(name) || isHttpEquivMeta(element, name),
	keepsHandlers: false,
	keepsUrl: (value, element, attribute) =>
		element !== "a" && attribute !== "xlink:href" && isDataUrl(value),
};

const SCRIPTED_POLICY: SanitizePolicy = {
	removes: (element, name) =>
		SCRIPTED_REMOVED.has(name) ||
		isHttpEquivMeta(element, name) ||
		(name === "link" && !isRemoteStylesheet(element)),
	keepsHandlers: true,
	keepsUrl: (value, element) =>
		isFragment(value) || (element !== "a" && element !== "area" && isSandboxedUrl(value)),
};

function anchorHref(element: Element): string | undefined {
	return Array.from(element.attributes).find((attribute) =>
		["href", "xlink:href"].includes(attribute.name.toLowerCase()),
	)?.value;
}

function sanitizeElement(element: Element, policy: SanitizePolicy): void {
	for (const child of Array.from(element.children)) {
		if (policy.removes(child, child.localName.toLowerCase())) child.remove();
		else sanitizeElement(child, policy);
	}

	const name = element.localName.toLowerCase();
	const href = name === "a" ? anchorHref(element) : undefined;
	if (href !== undefined && !policy.keepsUrl(href, name, "href")) {
		element.setAttribute("data-href", href);
		element.setAttribute("title", href);
	}

	for (const attribute of Array.from(element.attributes)) {
		const attributeName = attribute.name.toLowerCase();
		if (
			(attributeName.startsWith("on") && !policy.keepsHandlers) ||
			REMOVED_ATTRIBUTES.has(attributeName) ||
			(URL_ATTRIBUTES.has(attributeName) && !policy.keepsUrl(attribute.value, name, attributeName))
		) {
			element.removeAttribute(attribute.name);
		}
	}
}

export function sanitizeHtmlDocument(document: Document): void {
	sanitizeElement(document.documentElement, STATIC_POLICY);
}

function installPreviewPolicy(document: Document, csp: string, ...rest: Element[]): void {
	const charset = document.createElement("meta");
	charset.setAttribute("charset", "utf-8");
	const policy = document.createElement("meta");
	policy.setAttribute("http-equiv", "Content-Security-Policy");
	policy.setAttribute("content", csp);
	document.head.prepend(charset, policy, ...rest);
}

const serialize = (document: Document) => `<!doctype html>${document.documentElement.outerHTML}`;

export function prepareHtmlPreviewDocument(document: Document): string {
	sanitizeHtmlDocument(document);
	installPreviewPolicy(document, HTML_PREVIEW_CSP);
	return serialize(document);
}

export function buildHtmlPreviewDocument(source: string): string {
	const document = new DOMParser().parseFromString(source, "text/html");
	return prepareHtmlPreviewDocument(document);
}

export function prepareScriptedHtmlDocument(
	document: Document,
	themeCss: string,
	nonce: string,
): string {
	sanitizeElement(document.documentElement, SCRIPTED_POLICY);
	const theme = document.createElement("style");
	theme.setAttribute("data-thinkrail-theme", "");
	theme.textContent = themeCss;
	const bootstrap = document.createElement("script");
	bootstrap.textContent = frameBootstrap(nonce);
	installPreviewPolicy(document, SCRIPTED_HTML_CSP, theme, bootstrap);
	return serialize(document);
}

export function buildScriptedHtmlDocument(source: string, themeCss: string) {
	const document = new DOMParser().parseFromString(source, "text/html");
	const nonce = frameNonce();
	return { html: prepareScriptedHtmlDocument(document, themeCss, nonce), nonce };
}
