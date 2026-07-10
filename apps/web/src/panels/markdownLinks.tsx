import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import { getTransport } from "../transport";
import { openFileInTab } from "./openFile";

/**
 * Link / image / heading-anchor handling for the rendered markdown view. All wired only into
 * `MarkdownPreview` (chat is untouched):
 *  - `remarkHeadingIds` — a dependency-free remark transform giving headings slug ids (for `#` targets).
 *  - `documentComponents(ctx)` — the `a` + `img` renderers: relative links open the target file as a
 *    tab, `#` links scroll the preview, relative images resolve to the host `/files/…` endpoint.
 */

export type HrefKind = "empty" | "anchor" | "external" | "relative";

/** Classify a link/image target: in-doc anchor, absolute/external, or a worktree-relative path. */
export function classifyHref(href: string | undefined): HrefKind {
	if (!href) return "empty";
	if (href.startsWith("#")) return "anchor";
	if (href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return "external";
	return "relative";
}

/** Resolve a relative link `href` against the worktree-relative `fromFile`'s directory (posix). */
export function resolveRelativePath(fromFile: string, href: string): string {
	const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
	const segs = href.startsWith("/") || dir === "" ? [] : dir.split("/");
	for (const seg of href.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") segs.pop();
		else segs.push(seg);
	}
	return segs.join("/");
}

/** GitHub-style heading slug: lowercase, drop punctuation, spaces → hyphens. */
export function slugify(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-");
}

function splitHash(href: string): { path: string; hash: string } {
	const i = href.indexOf("#");
	return i < 0 ? { path: href, hash: "" } : { path: href.slice(0, i), hash: href.slice(i + 1) };
}

function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

// Minimal structural mdast shapes — only the fields this transform reads/writes (no @types/mdast dep).
interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	data?: { hProperties?: Record<string, unknown> };
}

function headingText(node: MdNode): string {
	if (typeof node.value === "string") return node.value;
	return (node.children ?? []).map(headingText).join("");
}

/** Remark plugin: give each heading a unique slug `id` (deduped per document) so `#section` links work. */
export function remarkHeadingIds() {
	return (tree: MdNode): void => {
		const seen = new Map<string, number>();
		walk(tree, (node) => {
			if (node.type !== "heading") return;
			const base = slugify(headingText(node));
			if (!base) return;
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			const id = n === 0 ? base : `${base}-${n}`;
			node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
		});
	};
}

function walk(node: MdNode, visit: (n: MdNode) => void): void {
	visit(node);
	for (const child of node.children ?? []) walk(child, visit);
}

function scrollToAnchor(id: string): void {
	document
		.getElementById(decodeURIComponent(id))
		?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Build the `a` + `img` renderers for a file at `path` in `workspaceId`. */
export function documentComponents(ctx: { workspaceId: string; path: string }): Components {
	function DocumentLink({ href, children }: { href?: string; children?: ReactNode }) {
		const kind = classifyHref(href);
		if (kind === "anchor" && href) {
			return (
				<a
					href={href}
					onClick={(e) => {
						e.preventDefault();
						scrollToAnchor(href.slice(1));
					}}
				>
					{children}
				</a>
			);
		}
		if (kind === "relative" && href) {
			return (
				<a
					href={href}
					onClick={(e) => {
						e.preventDefault();
						const target = resolveRelativePath(ctx.path, splitHash(href).path);
						if (target) void openFileInTab(ctx.workspaceId, target);
					}}
				>
					{children}
				</a>
			);
		}
		return (
			<a href={href} target="_blank" rel="noopener noreferrer">
				{children}
			</a>
		);
	}

	function DocumentImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
		const resolved =
			classifyHref(src) === "relative" && src
				? `${getTransport().httpBase()}/files/${encodeURIComponent(ctx.workspaceId)}/${encodePath(
						resolveRelativePath(ctx.path, src),
					)}`
				: src;
		return <img src={resolved} alt={alt ?? ""} title={title} />;
	}

	return { a: DocumentLink, img: DocumentImage } as Components;
}
