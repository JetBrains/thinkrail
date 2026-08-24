import { useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiffTab } from "../store";
import { MarkdownDocument } from "./MarkdownPreview";

const DIFF_MARKS = [
	"[&_ins]:rounded-[var(--radius-sm)] [&_ins]:bg-feedback-success-subtle [&_ins]:text-feedback-success [&_ins]:no-underline",
	"[&_del]:rounded-[var(--radius-sm)] [&_del]:bg-feedback-error-subtle [&_del]:text-feedback-error",
].join(" ");

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
		<div data-testid="rendered-diff" className="h-full overflow-auto bg-container-content-bg">
			<article
				className={`mx-auto max-w-[78ch] px-24 py-16 ${DIFF_MARKS}`}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: htmldiff meshing of our own escaped react-markdown output (user-approved; same risk class as the shiki path in chat/Markdown)
				dangerouslySetInnerHTML={{ __html: merge.html }}
			/>
		</div>
	);
}
