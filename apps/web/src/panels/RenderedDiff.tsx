import { RiExpandUpDownLine as Expand } from "@remixicon/react";
import { createElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResourceDiffProps } from "@/resources";
import { MarkdownDocument } from "./MarkdownPreview";
import { focusSegments } from "./renderedDiffFocus";
import { useScrollViewState } from "./useScrollViewState";

const DIFF_MARKS = [
	"[&_ins]:rounded-[var(--radius-sm)] [&_ins]:bg-feedback-success-subtle [&_ins]:text-feedback-success [&_ins]:no-underline",
	"[&_del]:rounded-[var(--radius-sm)] [&_del]:bg-feedback-error-subtle [&_del]:text-feedback-error",
].join(" ");

const CHANGE_SELECTOR = "ins, del, [data-diff-node]";
const LIST_TAGS = new Set(["ul", "ol"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BOOLEAN_ATTRIBUTES = new Set(["open", "reversed", "hidden", "checked", "disabled"]);

type MergeState = { state: "pending" } | { state: "failed" } | { state: "done"; html: string };
const PENDING: MergeState = { state: "pending" };
const FAILED: MergeState = { state: "failed" };

function useHtmldiffMerge(before: string, after: string): MergeState {
	const [merge, setMerge] = useState<MergeState>(PENDING);

	useEffect(() => {
		setMerge(PENDING);
		const worker = new Worker(new URL("./htmldiff.worker.ts", import.meta.url), {
			type: "module",
		});
		worker.onmessage = (event: MessageEvent<string>) =>
			setMerge({ state: "done", html: event.data });
		worker.onerror = () => setMerge(FAILED);
		worker.onmessageerror = () => setMerge(FAILED);
		worker.postMessage({ before, after });
		return () => worker.terminate();
	}, [before, after]);

	return merge;
}

function hasChange(element: Element): boolean {
	return element.matches(CHANGE_SELECTOR) || element.querySelector(CHANGE_SELECTOR) !== null;
}

type ElementProps = Record<string, string | number | boolean | { __html: string }>;

function elementProps(element: Element): ElementProps {
	const props: ElementProps = {};
	for (const { name, value } of element.attributes) {
		if (name === "class") props.className = value;
		else props[name] = BOOLEAN_ATTRIBUTES.has(name) ? true : value;
	}
	return props;
}

function Block({ element, ordinal }: { element: Element; ordinal: number | undefined }) {
	const props = elementProps(element);
	if (ordinal !== undefined) props.value = ordinal;
	if (LIST_TAGS.has(element.localName) && hasChange(element)) {
		return createElement(
			element.localName,
			props,
			<FocusedChildren parent={element} unit="items" />,
		);
	}
	const html = element.innerHTML;
	return createElement(
		element.localName,
		html === "" ? props : { ...props, dangerouslySetInnerHTML: { __html: html } },
	);
}

type Ordinal = (position: number) => number | undefined;

function blockNodes(items: Element[], first: number, ordinal: Ordinal): ReactNode[] {
	const nodes: ReactNode[] = [];
	let position = first;
	for (const element of items) {
		nodes.push(<Block key={position} element={element} ordinal={ordinal(position)} />);
		position++;
	}
	return nodes;
}

function HiddenRun({
	items,
	first,
	unit,
	ordinal,
}: {
	items: Element[];
	first: number;
	unit: "blocks" | "items";
	ordinal: Ordinal;
}) {
	const [expanded, setExpanded] = useState(false);
	if (expanded) return blockNodes(items, first, ordinal);
	const section =
		unit === "blocks"
			? items.findLast((element) => HEADING_TAGS.has(element.localName))?.textContent?.trim()
			: undefined;
	const bar = (
		<button
			type="button"
			data-testid="rendered-diff-collapsed"
			onClick={() => setExpanded(true)}
			className="my-12 flex w-full items-center gap-8 rounded-[var(--radius-sm)] bg-container-header-bg px-12 py-4 tr-text-metadata text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
		>
			<Expand className="size-14 shrink-0" />
			<span className="shrink-0">
				{items.length} unchanged {unit}
			</span>
			{section ? (
				<span className="ml-auto min-w-0 truncate text-text-subtle">§ {section}</span>
			) : null}
		</button>
	);
	return unit === "items" ? <li className="list-none">{bar}</li> : bar;
}

function FocusedChildren({ parent, unit }: { parent: Element; unit: "blocks" | "items" }) {
	const segments = focusSegments(Array.from(parent.children), hasChange);
	const start = parent.localName === "ol" ? Number(parent.getAttribute("start") ?? "1") : null;
	const ordinal: Ordinal = (position) => (start === null ? undefined : start + position);
	const nodes: ReactNode[] = [];
	let first = 0;
	for (const segment of segments) {
		if (segment.kind === "visible") {
			nodes.push(...blockNodes(segment.items, first, ordinal));
		} else {
			nodes.push(
				<HiddenRun
					key={`hidden-${first}`}
					items={segment.items}
					first={first}
					unit={unit}
					ordinal={ordinal}
				/>,
			);
		}
		first += segment.items.length;
	}
	return nodes;
}

function Placeholder({ testid, children }: { testid: string; children: string }) {
	return (
		<div
			data-testid={testid}
			className="flex h-full items-center justify-center bg-container-content-bg text-text-muted"
		>
			{children}
		</div>
	);
}

export default function RenderedDiff({
	resource,
	original,
	modified,
	viewState,
	onViewState,
}: ResourceDiffProps) {
	const originalText = original.kind === "text" ? original.text : "";
	const modifiedText = modified.kind === "text" ? modified.text : "";
	const [before, after] = useMemo(
		() => [
			renderToStaticMarkup(
				<MarkdownDocument
					content={originalText}
					workspaceId={resource.workspaceId}
					path={resource.path}
				/>,
			),
			renderToStaticMarkup(
				<MarkdownDocument
					content={modifiedText}
					workspaceId={resource.workspaceId}
					path={resource.path}
				/>,
			),
		],
		[originalText, modifiedText, resource.workspaceId, resource.path],
	);
	const merge = useHtmldiffMerge(before, after);
	const root = useMemo(() => {
		if (merge.state !== "done") return null;
		const body = new DOMParser().parseFromString(merge.html, "text/html").body;
		return (body.children.length === 1 ? body.firstElementChild : null) ?? body;
	}, [merge]);
	const { attach: attachScroller } = useScrollViewState<HTMLDivElement>(viewState, onViewState);

	if (merge.state === "failed") {
		return (
			<Placeholder testid="rendered-diff-error">
				Rendered diff failed — use the Source view.
			</Placeholder>
		);
	}
	if (root === null) {
		return <Placeholder testid="rendered-diff-loading">Rendering diff…</Placeholder>;
	}

	return (
		<div
			ref={attachScroller}
			data-testid="rendered-diff"
			className="h-full overflow-auto bg-container-content-bg motion-safe:animate-reveal"
		>
			{hasChange(root) ? null : (
				<p data-testid="rendered-diff-empty" className="px-12 py-8 tr-text-ui text-text-muted">
					The rendered preview is identical on both sides — the change is in front matter,
					whitespace, or markup that does not render. Compare in Source.
				</p>
			)}
			<article className={`mx-auto max-w-[78ch] px-24 py-16 ${DIFF_MARKS}`}>
				<div className={root.getAttribute("class") ?? undefined}>
					<FocusedChildren parent={root} unit="blocks" />
				</div>
			</article>
		</div>
	);
}
