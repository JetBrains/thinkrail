import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import { getTransport } from "../transport";
import { openFileInTab } from "./openTabs";

export type HrefKind = "empty" | "anchor" | "external" | "relative";

export function classifyHref(href: string | undefined): HrefKind {
	if (!href) return "empty";
	if (href.startsWith("#")) return "anchor";
	if (href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return "external";
	return "relative";
}

export function resolveRelativePath(fromFile: string, href: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(href).replaceAll("\\", "/");
	} catch {
		return null;
	}
	if (!decoded) return null;
	const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
	const segs = decoded.startsWith("/") || dir === "" ? [] : dir.split("/");
	for (const seg of decoded.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			if (segs.length === 0) return null;
			segs.pop();
		} else segs.push(seg);
	}
	return segs.join("/") || null;
}

export function slugify(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-");
}

function relativePathname(href: string): string {
	const i = href.search(/[?#]/);
	return i < 0 ? href : href.slice(0, i);
}

function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

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
			const target = resolveRelativePath(ctx.path, relativePathname(href));
			return (
				<button
					type="button"
					data-testid="markdown-file-link"
					data-path={target ?? undefined}
					disabled={!target}
					onClick={() => {
						if (target) void openFileInTab(ctx.workspaceId, target, "preview");
					}}
					className="cursor-pointer text-left text-primary underline decoration-primary-muted underline-offset-2 hover:decoration-primary disabled:cursor-default"
				>
					{children}
				</button>
			);
		}
		return (
			<a href={href} target="_blank" rel="noopener noreferrer">
				{children}
			</a>
		);
	}

	function DocumentImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
		const isRelative = classifyHref(src) === "relative" && src !== undefined;
		const target = isRelative ? resolveRelativePath(ctx.path, relativePathname(src)) : null;
		const resolved = isRelative
			? target
				? `${getTransport().httpBase()}/files/${encodeURIComponent(ctx.workspaceId)}/${encodePath(target)}`
				: undefined
			: src;
		return <img src={resolved} alt={alt ?? ""} title={title} />;
	}

	return { a: DocumentLink, img: DocumentImage } as Components;
}
