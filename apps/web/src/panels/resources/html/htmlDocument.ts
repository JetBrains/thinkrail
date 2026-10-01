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
