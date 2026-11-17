export type WikiLinkTarget =
	| { kind: "page"; path: string; anchor: string }
	| { kind: "external"; href: string }
	| { kind: "anchor"; id: string }
	| { kind: "none" };

const EXTERNAL = /^(?:https?:|mailto:)/i;

function resolveSegments(directory: readonly string[], relative: string): string | null {
	const segments = [...directory];
	for (const part of relative.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (segments.pop() === undefined) return null;
		} else {
			segments.push(part);
		}
	}
	return segments.join("/");
}

/** Where a link in the article at `from` (POSIX, wiki-root relative) leads. */
export function resolveWikiLink(from: string, href: string | undefined): WikiLinkTarget {
	if (href === undefined || href === "") return { kind: "none" };
	if (href.startsWith("#")) return { kind: "anchor", id: decodeURIComponent(href.slice(1)) };
	if (EXTERNAL.test(href)) return { kind: "external", href };
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) return { kind: "none" };
	const hash = href.indexOf("#");
	const file = hash === -1 ? href : href.slice(0, hash);
	const anchor = hash === -1 ? "" : href.slice(hash + 1);
	let decoded: string;
	try {
		decoded = decodeURIComponent(file);
	} catch {
		return { kind: "none" };
	}
	if (!decoded.endsWith(".md")) return { kind: "none" };
	const directory = from.split("/").slice(0, -1);
	const path = resolveSegments(directory, decoded);
	return path === null ? { kind: "none" } : { kind: "page", path, anchor };
}
