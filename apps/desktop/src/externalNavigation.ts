import type { EventEmitter } from "node:events";
import type Electrobun from "electrobun/main";

type NavigationEvent = ReturnType<
	(typeof Electrobun.events.events.webview)["willNavigate" | "newWindowOpen"]
>;

type LinkRoutingWindow = Pick<Window, "addEventListener" | "open"> & {
	location: Pick<Location, "origin" | "assign">;
};

const MAX_NAVIGATION_DETAIL_LENGTH = 64 * 1024;

export function externalNavigationUrl(value: unknown, origin: string): string | null {
	let detail = value;
	if (typeof detail === "string") {
		if (detail.length > MAX_NAVIGATION_DETAIL_LENGTH) return null;
		if (detail.trimStart().startsWith("{")) {
			try {
				detail = JSON.parse(detail);
			} catch {
				return null;
			}
		}
	}
	const raw =
		typeof detail === "string"
			? detail
			: typeof detail === "object" &&
					detail !== null &&
					!Array.isArray(detail) &&
					"url" in detail &&
					typeof detail.url === "string"
				? detail.url
				: null;
	if (!raw || raw.length > MAX_NAVIGATION_DETAIL_LENGTH) return null;
	try {
		const url = new URL(raw, origin);
		if (url.origin === origin) return null;
		return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

export function windowNavigationRules(origin: string): string[] {
	return ["^*", `${origin}/*`, "about:srcdoc", `blob:${origin}/*`];
}

function isElement(target: EventTarget | null): target is Element {
	return (
		target !== null && typeof target === "object" && "nodeType" in target && target.nodeType === 1
	);
}

function activatedLinkHref(target: EventTarget | null): string | null {
	if (!isElement(target)) return null;
	const anchor = target.closest("a[href]");
	if (!anchor || anchor.hasAttribute("download") || !("href" in anchor)) return null;
	return typeof anchor.href === "string" ? anchor.href : null;
}

export function installExternalLinkRouting(view: LinkRoutingWindow): void {
	const route = (event: Event) => {
		const click = event as MouseEvent;
		if (click.defaultPrevented || click.button > 1 || click.ctrlKey || click.metaKey) return;
		const href = activatedLinkHref(click.target);
		const url = href === null ? null : externalNavigationUrl(href, view.location.origin);
		if (!url) return;
		click.preventDefault();
		view.location.assign(url);
	};
	view.addEventListener("click", route);
	view.addEventListener("auxclick", route);
	const open = view.open.bind(view);
	view.open = (url?: string | URL, target?: string, features?: string) => {
		const external =
			url === undefined ? null : externalNavigationUrl(String(url), view.location.origin);
		if (!external) return open(url, target, features);
		view.location.assign(external);
		return null;
	};
}

export function installExternalNavigation(
	events: Pick<EventEmitter, "on" | "off">,
	webviewId: number,
	origin: string,
	openExternal: (url: string) => unknown,
): () => void {
	const names = [`will-navigate-${webviewId}`, `new-window-open-${webviewId}`];
	const onNavigation = (event: NavigationEvent) => {
		const url = externalNavigationUrl(event.data.detail, origin);
		if (url) openExternal(url);
	};
	for (const name of names) events.on(name, onNavigation);
	return () => {
		for (const name of names) events.off(name, onNavigation);
	};
}
