import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import { DOCUMENT_ID_PREFIX } from "./markdownHtml";
import { openFileInTab } from "./openTabs";
import { resourceBytesUrl } from "./resourcePane";

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
	const slug = decodeURIComponent(id);
	(
		document.getElementById(`${DOCUMENT_ID_PREFIX}${slug}`) ?? document.getElementById(slug)
	)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const WEB_URL = /^(?:https?:)?\/\//i;

export function srcsetCandidates(srcSet: string): { url: string; descriptor: string }[] {
	const candidates: { url: string; descriptor: string }[] = [];
	let index = 0;
	while (index < srcSet.length) {
		while (index < srcSet.length && /[\s,]/.test(srcSet[index] ?? "")) index += 1;
		if (index >= srcSet.length) break;
		let end = index;
		while (end < srcSet.length && !/\s/.test(srcSet[end] ?? "")) end += 1;
		let url = srcSet.slice(index, end);
		index = end;
		let descriptor = "";
		if (url.endsWith(",")) {
			url = url.replace(/,+$/, "");
		} else {
			let depth = 0;
			let stop = index;
			while (stop < srcSet.length) {
				const char = srcSet[stop] ?? "";
				if (char === "(") depth += 1;
				else if (char === ")") depth = Math.max(0, depth - 1);
				else if (char === "," && depth === 0) break;
				stop += 1;
			}
			descriptor = srcSet.slice(index, stop).trim();
			index = stop + 1;
		}
		if (url) candidates.push({ url, descriptor });
	}
	return candidates;
}

export function documentComponents(
	ctx: { workspaceId: string; path: string },
	bytesUrl: (workspaceId: string, path: string) => string = resourceBytesUrl,
): Components {
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

	const resolveSource = (src: string | undefined): string | undefined => {
		if (src === undefined) return undefined;
		if (classifyHref(src) !== "relative") return WEB_URL.test(src) ? src : undefined;
		const target = resolveRelativePath(ctx.path, relativePathname(src));
		return target ? bytesUrl(ctx.workspaceId, target) : undefined;
	};
	const resolveSourceSet = (srcSet: string | undefined): string | undefined => {
		if (srcSet === undefined) return undefined;
		const resolved = srcsetCandidates(srcSet).flatMap(({ url, descriptor }) => {
			const source = resolveSource(url);
			return source ? [descriptor ? `${source} ${descriptor}` : source] : [];
		});
		return resolved.length > 0 ? resolved.join(", ") : undefined;
	};

	function DocumentImage({
		src,
		alt,
		title,
		width,
		height,
		align,
	}: {
		src?: string;
		alt?: string;
		title?: string;
		width?: string | number;
		height?: string | number;
		align?: string;
	}) {
		const floated =
			align === "right" ? "float-right ml-8" : align === "left" ? "float-left mr-8" : undefined;
		return (
			<img
				src={resolveSource(src)}
				alt={alt ?? ""}
				title={title}
				width={width}
				height={height}
				className={floated}
			/>
		);
	}

	function DocumentSource({
		srcSet,
		media,
		type,
		sizes,
	}: {
		srcSet?: string;
		media?: string;
		type?: string;
		sizes?: string;
	}) {
		return <source srcSet={resolveSourceSet(srcSet)} media={media} type={type} sizes={sizes} />;
	}

	return { a: DocumentLink, img: DocumentImage, source: DocumentSource } as Components;
}
