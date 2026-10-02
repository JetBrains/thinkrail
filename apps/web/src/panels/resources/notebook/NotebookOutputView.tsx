import { type ReactNode, useMemo } from "react";
import type { Components } from "react-markdown";
import { Markdown } from "@/chat/Markdown";
import { classifyHref, resolveRelativePath } from "../../markdownLinks";
import { resourceBytesUrl } from "../../resourcePane";
import type { NotebookCell, NotebookOutput } from "./notebookModel";
import {
	buildNotebookHtmlDocument,
	buildNotebookSvgDocument,
	notebookImageDataUrl,
} from "./outputDocument";

const RASTER_DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i;
const SVG_DATA_IMAGE = /^data:image\/svg\+xml((?:;[^,]*)?),(.*)$/is;

function svgDataImageSource(src: string): string | null {
	const match = SVG_DATA_IMAGE.exec(src);
	if (!match) return null;
	try {
		const parameters = (match[1] ?? "")
			.split(";")
			.filter(Boolean)
			.map((value) => value.toLowerCase());
		const payload = match[2] ?? "";
		if (!parameters.includes("base64")) return decodeURIComponent(payload);
		const binary = atob(payload.replaceAll(/\s/g, ""));
		return new TextDecoder().decode(Uint8Array.from(binary, (value) => value.charCodeAt(0)));
	} catch {
		return null;
	}
}

export interface NotebookResourceContext {
	workspaceId: string;
	path: string;
}

function notebookImageSource(
	src: string | undefined,
	ctx: NotebookResourceContext,
	bytesUrl: (workspaceId: string, path: string) => string,
): { kind: "image"; src: string } | { kind: "svg"; svg: string } | { kind: "disabled" } {
	if (!src) return { kind: "disabled" };
	if (RASTER_DATA_IMAGE.test(src)) return { kind: "image", src };
	const svg = svgDataImageSource(src);
	if (svg !== null) return { kind: "svg", svg };
	if (classifyHref(src) === "relative") {
		const target = resolveRelativePath(ctx.path, src.split(/[?#]/, 1)[0] ?? src);
		if (target) return { kind: "image", src: bytesUrl(ctx.workspaceId, target) };
	}
	return { kind: "disabled" };
}

export function notebookMarkdownComponents(
	ctx: NotebookResourceContext,
	bytesUrl: (workspaceId: string, path: string) => string = resourceBytesUrl,
): Components {
	function NotebookMarkdownImage({
		src,
		alt,
		title,
	}: {
		src?: string | undefined;
		alt?: string | undefined;
		title?: string | undefined;
	}) {
		const source = notebookImageSource(src, ctx, bytesUrl);
		if (source.kind === "image") return <img src={source.src} alt={alt ?? ""} title={title} />;
		if (source.kind === "svg") {
			return (
				<NotebookFrame
					title={title ?? alt ?? "Notebook SVG image"}
					document={buildNotebookSvgDocument(source.svg)}
				/>
			);
		}
		return (
			<span data-testid="notebook-disabled-image" className="text-text-muted">
				{alt ? `${alt}: ` : "Image disabled: "}
				{src ?? "missing URL"}
			</span>
		);
	}
	return { img: NotebookMarkdownImage, a: NotebookMarkdownLink } as Components;
}

function NotebookMarkdownLink({
	href,
	children,
}: {
	href?: string | undefined;
	children?: ReactNode;
}) {
	return (
		<span data-testid="notebook-disabled-link">
			{children}
			{href ? ` (${href})` : ""}
		</span>
	);
}

export function notebookMarkdownUrlTransform(url: string): string {
	return url;
}

function JsonValue({ value, name }: { value: unknown; name?: string }) {
	const label = name === undefined ? null : <span className="text-primary">{name}: </span>;
	if (Array.isArray(value)) {
		return (
			<details open className="pl-8 tr-code-text text-text-default">
				<summary className="cursor-pointer">
					{label}[{value.length}]
				</summary>
				<div className="border-border-muted border-l pl-8">
					{value.map((entry, index) => (
						<JsonValue key={`${index}:${typeof entry}`} value={entry} name={String(index)} />
					))}
				</div>
			</details>
		);
	}
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value);
		return (
			<details open className="pl-8 tr-code-text text-text-default">
				<summary className="cursor-pointer">
					{label}
					{`{${entries.length}}`}
				</summary>
				<div className="border-border-muted border-l pl-8">
					{entries.map(([key, entry]) => (
						<JsonValue key={key} value={entry} name={key} />
					))}
				</div>
			</details>
		);
	}
	return (
		<div className="pl-8 tr-code-text text-text-default">
			{label}
			{typeof value === "string" ? JSON.stringify(value) : String(value)}
		</div>
	);
}

export function NotebookFrame({
	title,
	document,
	fill = false,
}: {
	title: string;
	document: string;
	fill?: boolean;
}) {
	return (
		<iframe
			title={title}
			sandbox=""
			srcDoc={document}
			className={
				fill
					? "pointer-events-none h-full w-full border-0"
					: "h-[240px] w-full border border-border-muted bg-container-workspace-bg"
			}
		/>
	);
}

export function NotebookOutputItem({ output, title }: { output: NotebookOutput; title: string }) {
	if (output.kind === "error") {
		return (
			<pre className="overflow-auto whitespace-pre-wrap border-feedback-error border-l-2 bg-feedback-error-subtle p-8 tr-code-text text-feedback-error">
				{output.text}
			</pre>
		);
	}
	if (output.kind === "text") {
		return (
			<pre className="overflow-auto whitespace-pre-wrap bg-container-content-bg p-8 tr-code-text text-text-default">
				{output.text}
			</pre>
		);
	}
	if (output.kind === "image") {
		if (output.mime === "image/svg+xml") {
			return <NotebookFrame title={title} document={buildNotebookSvgDocument(output.data)} />;
		}
		return (
			<img
				src={notebookImageDataUrl(output.mime, output.data)}
				alt={title}
				className="block max-h-[480px] max-w-full object-contain"
			/>
		);
	}
	if (output.kind === "html") {
		return <NotebookFrame title={title} document={buildNotebookHtmlDocument(output.html)} />;
	}
	return (
		<div className="overflow-auto bg-container-content-bg p-8">
			<JsonValue value={output.value} />
		</div>
	);
}

function codeFence(source: string): string {
	const longest = [...source.matchAll(/`+/g)].reduce(
		(maximum, match) => Math.max(maximum, match[0].length),
		0,
	);
	return "`".repeat(Math.max(3, longest + 1));
}

export function NotebookOutputs({ cell }: { cell: NotebookCell }) {
	return cell.outputs.length > 0 ? (
		<div className="flex flex-col gap-4 border-border-muted border-t p-8">
			{cell.outputs.map((output, index) => (
				<NotebookOutputItem
					key={`${output.kind}:${index}`}
					output={output}
					title={`Output ${index + 1} of cell ${cell.index + 1}`}
				/>
			))}
		</div>
	) : null;
}

export function NotebookCellBody({
	cell,
	language,
	resource,
}: {
	cell: NotebookCell;
	language: string;
	resource: NotebookResourceContext;
}) {
	const components = useMemo(
		() => notebookMarkdownComponents({ workspaceId: resource.workspaceId, path: resource.path }),
		[resource.path, resource.workspaceId],
	);
	let source: ReactNode;
	if (cell.type === "markdown") {
		source = (
			<Markdown
				text={cell.source}
				className="tr-prose-doc max-w-none break-words text-text-default [&_pre]:my-8"
				components={components}
				urlTransform={notebookMarkdownUrlTransform}
			/>
		);
	} else if (cell.type === "code") {
		const fence = codeFence(cell.source);
		source = (
			<Markdown
				text={`${fence}${language}\n${cell.source}\n${fence}`}
				className="[&_pre]:!m-0 [&_pre]:rounded-none"
				components={components}
				urlTransform={notebookMarkdownUrlTransform}
			/>
		);
	} else {
		source = (
			<pre className="overflow-auto whitespace-pre-wrap p-8 tr-code-text text-text-muted">
				{cell.source}
			</pre>
		);
	}
	return (
		<div className="min-w-0 flex-1">
			<div className="p-12">{source}</div>
			<NotebookOutputs cell={cell} />
		</div>
	);
}
