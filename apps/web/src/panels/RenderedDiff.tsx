import htmldiff from "node-htmldiff";
import { useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiffTab } from "../store";
import { MarkdownDocument } from "./MarkdownPreview";

/** Marker skin for the merged document — token colors only, so it wears any theme. */
const DIFF_MARKS = [
	"[&_ins]:rounded-[var(--radius-sm)] [&_ins]:bg-green/15 [&_ins]:text-green [&_ins]:no-underline",
	"[&_del]:rounded-[var(--radius-sm)] [&_del]:bg-red/15 [&_del]:text-red",
].join(" ");

/**
 * The rendered ("rich") markdown diff — see the panels SPEC + [[task-rendered-markdown-diff]]. Both
 * sides go through the exact same document pipeline as the plain preview (`MarkdownDocument`) to static
 * HTML (`renderToStaticMarkup` — effects don't run, so code blocks show the plain fallback and link
 * handlers are inert; accepted for a diff view), then `node-htmldiff` merges them into ONE document
 * with `<ins>`/`<del>` markers: deletions red + struck through, insertions green.
 */
export default function RenderedDiff({ tab }: { tab: DiffTab }) {
	const merged = useMemo(
		() =>
			htmldiff(
				renderToStaticMarkup(
					<MarkdownDocument content={tab.original} workspaceId={tab.workspaceId} path={tab.path} />,
				),
				renderToStaticMarkup(
					<MarkdownDocument content={tab.modified} workspaceId={tab.workspaceId} path={tab.path} />,
				),
			),
		[tab.original, tab.modified, tab.workspaceId, tab.path],
	);

	return (
		<div data-testid="rendered-diff" className="h-full overflow-auto bg-surface-content">
			<article
				className={`mx-auto max-w-[78ch] px-xl py-lg ${DIFF_MARKS}`}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: htmldiff meshing of our own escaped react-markdown output (user-approved; same risk class as the shiki path in chat/Markdown)
				dangerouslySetInnerHTML={{ __html: merged }}
			/>
		</div>
	);
}
