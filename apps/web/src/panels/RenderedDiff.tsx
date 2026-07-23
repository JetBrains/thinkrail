import { useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiffTab } from "../store";
import { MarkdownDocument } from "./MarkdownPreview";

/** Marker skin for the merged document — token colors only, so it wears any theme. */
const DIFF_MARKS = [
	"[&_ins]:rounded-[var(--radius-sm)] [&_ins]:bg-green/15 [&_ins]:text-green [&_ins]:no-underline",
	"[&_del]:rounded-[var(--radius-sm)] [&_del]:bg-red/15 [&_del]:text-red",
].join(" ");

type MergeState = { state: "pending" } | { state: "failed" } | { state: "done"; html: string };
const PENDING: MergeState = { state: "pending" };
const FAILED: MergeState = { state: "failed" };

/**
 * The htmldiff merge, off the main thread. htmldiff is super-linear on repetitive content (seconds of
 * synchronous blocking for a few hundred identical rows), so it must never run inline — the two
 * static-HTML sides go to a Web Worker (`htmldiff.worker.ts`) and the merged document comes back as a
 * message. One worker per pending request: a new input (live re-read) or unmount terminates it —
 * termination *is* the cancellation, so no stale result can land. A worker failure (the script asset
 * failing to load — e.g. deploy skew — or htmldiff throwing) resolves to `failed`, never an eternal
 * `pending`.
 */
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

/** The full-pane centered placeholder both non-done states render. */
function Placeholder({ testid, children }: { testid: string; children: string }) {
	return (
		<div
			data-testid={testid}
			className="flex h-full items-center justify-center bg-surface-content text-hint"
		>
			{children}
		</div>
	);
}

/**
 * The rendered ("rich") markdown diff — see the panels SPEC + [[task-rendered-markdown-diff]]. Both
 * sides go through the exact same document pipeline as the plain preview (`MarkdownDocument`) to static
 * HTML (`renderToStaticMarkup` — effects don't run, so code blocks show the plain fallback and link
 * handlers are inert; accepted for a diff view), then `node-htmldiff` merges them into ONE document
 * with `<ins>`/`<del>` markers: deletions red + struck through, insertions green. Rendering both
 * sides to static markup is linear and stays on the main thread; the merge itself runs off it — see
 * `useHtmldiffMerge`. While it computes, a `rendered-diff-loading` placeholder shows; if the worker
 * fails, a `rendered-diff-error` placeholder points at the Source view instead of spinning forever.
 */
export default function RenderedDiff({ tab }: { tab: DiffTab }) {
	const [before, after] = useMemo(
		() => [
			renderToStaticMarkup(
				<MarkdownDocument content={tab.original} workspaceId={tab.workspaceId} path={tab.path} />,
			),
			renderToStaticMarkup(
				<MarkdownDocument content={tab.modified} workspaceId={tab.workspaceId} path={tab.path} />,
			),
		],
		[tab.original, tab.modified, tab.workspaceId, tab.path],
	);
	const merge = useHtmldiffMerge(before, after);

	if (merge.state === "pending") {
		return <Placeholder testid="rendered-diff-loading">Rendering diff…</Placeholder>;
	}
	if (merge.state === "failed") {
		return (
			<Placeholder testid="rendered-diff-error">
				Rendered diff failed — use the Source view.
			</Placeholder>
		);
	}

	return (
		<div data-testid="rendered-diff" className="h-full overflow-auto bg-surface-content">
			<article
				className={`mx-auto max-w-[78ch] px-xl py-lg ${DIFF_MARKS}`}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: htmldiff meshing of our own escaped react-markdown output (user-approved; same risk class as the shiki path in chat/Markdown)
				dangerouslySetInnerHTML={{ __html: merge.html }}
			/>
		</div>
	);
}
