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
const BOOLEAN_ATTRIBUTES = new Set(["open", "hidden", "reversed"]);

type MergeState =
	| { state: "pending" }
	| { state: "failed" }
	| { state: "done"; html: string; before: string };
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
			setMerge({ state: "done", html: event.data, before });
		worker.onerror = () => setMerge(FAILED);
		worker.onmessageerror = () => setMerge(FAILED);
		worker.postMessage({ before, after });
		return () => worker.terminate();
	}, [before, after]);

	return merge;
}

type Changed = (element: Element) => boolean;
type Ordinal = (position: number) => number | undefined;

function hasMark(element: Element): boolean {
	return element.matches(CHANGE_SELECTOR) || element.querySelector(CHANGE_SELECTOR) !== null;
}

function parseRoot(html: string): Element {
	const body = new DOMParser().parseFromString(html, "text/html").body;
	return (body.children.length === 1 ? body.firstElementChild : null) ?? body;
}

function* units(root: Element): Generator<Element> {
	for (const block of root.children) {
		yield block;
		if (LIST_TAGS.has(block.localName)) yield* block.children;
	}
}

function changedUnits(merged: Element, before: Element): Set<Element> {
	const counterparts = new Map<string, number>();
	for (const unit of units(before)) {
		counterparts.set(unit.outerHTML, (counterparts.get(unit.outerHTML) ?? 0) + 1);
	}
	const changed = new Set<Element>();
	for (const unit of units(merged)) {
		const remaining = hasMark(unit) ? 0 : (counterparts.get(unit.outerHTML) ?? 0);
		if (remaining > 0) counterparts.set(unit.outerHTML, remaining - 1);
		else changed.add(unit);
	}
	return changed;
}

function listOrdinals(list: Element): Ordinal {
	if (list.localName !== "ol") return () => undefined;
	let next = Number(list.getAttribute("start") ?? "1");
	const ordinals = Array.from(list.children, (item) => {
		const explicit = Number(item.getAttribute("value"));
		const ordinal = item.hasAttribute("value") && Number.isInteger(explicit) ? explicit : next;
		next = ordinal + 1;
		return ordinal;
	});
	return (position) => ordinals[position];
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

function Block({
	element,
	ordinal,
	changed,
}: {
	element: Element;
	ordinal: number | undefined;
	changed: Changed;
}) {
	const props = elementProps(element);
	if (ordinal !== undefined) props.value = ordinal;
	if (LIST_TAGS.has(element.localName) && Array.from(element.children).some(changed)) {
		return createElement(
			element.localName,
			props,
			<FocusedChildren parent={element} unit="items" changed={changed} />,
		);
	}
	const html = element.innerHTML;
	return createElement(
		element.localName,
		html === "" ? props : { ...props, dangerouslySetInnerHTML: { __html: html } },
	);
}

function blockNodes(
	items: Element[],
	first: number,
	ordinal: Ordinal,
	changed: Changed,
): ReactNode[] {
	const nodes: ReactNode[] = [];
	let position = first;
	for (const element of items) {
		nodes.push(
			<Block key={position} element={element} ordinal={ordinal(position)} changed={changed} />,
		);
		position++;
	}
	return nodes;
}

function HiddenRun({
	items,
	first,
	unit,
	ordinal,
	changed,
}: {
	items: Element[];
	first: number;
	unit: "blocks" | "items";
	ordinal: Ordinal;
	changed: Changed;
}) {
	const [expanded, setExpanded] = useState(false);
	if (expanded) return blockNodes(items, first, ordinal, changed);
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

function FocusedChildren({
	parent,
	unit,
	changed,
}: {
	parent: Element;
	unit: "blocks" | "items";
	changed: Changed;
}) {
	const segments = focusSegments(Array.from(parent.children), changed);
	const ordinal = listOrdinals(parent);
	const nodes: ReactNode[] = [];
	let first = 0;
	for (const segment of segments) {
		if (segment.kind === "visible") {
			nodes.push(...blockNodes(segment.items, first, ordinal, changed));
		} else {
			nodes.push(
				<HiddenRun
					key={`hidden-${first}`}
					items={segment.items}
					first={first}
					unit={unit}
					ordinal={ordinal}
					changed={changed}
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
	const view = useMemo(() => {
		if (merge.state !== "done") return null;
		const root = parseRoot(merge.html);
		const changedSet = changedUnits(root, parseRoot(merge.before));
		const changed: Changed = (element) => changedSet.has(element);
		return { root, changed, empty: !Array.from(root.children).some(changed) };
	}, [merge]);
	const { attach: attachScroller } = useScrollViewState<HTMLDivElement>(viewState, onViewState);

	if (merge.state === "failed") {
		return (
			<Placeholder testid="rendered-diff-error">
				Rendered diff failed — use the Source view.
			</Placeholder>
		);
	}
	if (view === null) {
		return <Placeholder testid="rendered-diff-loading">Rendering diff…</Placeholder>;
	}

	return (
		<div
			ref={attachScroller}
			data-testid="rendered-diff"
			className="h-full overflow-auto bg-container-content-bg motion-safe:animate-reveal"
		>
			{view.empty ? (
				<p data-testid="rendered-diff-empty" className="px-12 py-8 tr-text-ui text-text-muted">
					The rendered preview is identical on both sides — the change is in front matter,
					whitespace, or markup that does not render. Compare in Source.
				</p>
			) : null}
			<article className={`mx-auto max-w-[78ch] px-24 py-16 ${DIFF_MARKS}`}>
				<div className={view.root.getAttribute("class") ?? undefined}>
					<FocusedChildren parent={view.root} unit="blocks" changed={view.changed} />
				</div>
			</article>
		</div>
	);
}
