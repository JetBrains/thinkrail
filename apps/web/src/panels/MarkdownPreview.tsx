import { useMemo } from "react";
import { stripFrontmatter } from "@/lib/utils";
import { Markdown, type MarkdownRehypePlugins } from "../chat/Markdown";
import { alertComponents, remarkGithubAlerts } from "./markdownAlerts";
import { documentComponents, remarkHeadingIds } from "./markdownLinks";
import { type ComposerInsert, PreviewCommenting } from "./PreviewCommenting";
import { ReviewThreadCard } from "./ReviewThreadCard";
import {
	frontmatterOffset,
	indivisibleSpans,
	snapSplitLine,
	sourceLineRehype,
} from "./sourceLines";
import type { EditorReview } from "./useReviewCommenting";

/**
 * Document "prose skin" for the file-tab rendered view: `tr-prose-doc` supplies ALL typography
 * (`typography.json` → `proseSystems.doc` — the same element set as the chat system, at a document
 * scale, so h1–h4 are larger than body copy), and this skin adds only what is not typography — reading
 * measure, vertical rhythm, heading rules, table chrome, blockquote rule, task lists, images. Reading
 * measure is capped (~78ch); wide tables and code blocks scroll within the column. Never add a
 * font-size, weight, leading or tracking here: change the JSON.
 */
const DOCUMENT_PROSE = [
	"tr-prose-doc max-w-none break-words text-pretty text-text-default",
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
	// Headings — spacing + section rules only (bigger top than bottom margin).
	"[&_h1]:mt-0 [&_h1]:mb-md [&_h1]:border-border-default [&_h1]:border-b [&_h1]:pb-xs [&_h1]:text-balance",
	"[&_h2]:mt-xl [&_h2]:mb-md [&_h2]:border-border-default [&_h2]:border-b [&_h2]:pb-xs [&_h2]:text-balance",
	"[&_h3]:mt-lg [&_h3]:mb-sm [&_h3]:text-balance",
	"[&_h4]:mt-lg [&_h4]:mb-sm [&_h4]:text-balance",
	"[&_h5]:mt-md [&_h5]:mb-xs",
	"[&_h6]:mt-md [&_h6]:mb-xs [&_h6]:text-text-muted",
	// Body + links.
	"[&_p]:my-md [&_strong]:text-text-default",
	"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary-muted hover:[&_a]:decoration-primary",
	// Lists — GitHub's ~2em indent + tight item spacing; nested lists tighten further.
	"[&_ul]:my-md [&_ul]:list-disc [&_ul]:pl-[1.6em] [&_ol]:my-md [&_ol]:list-decimal [&_ol]:pl-[1.6em] [&_li]:my-1",
	"[&_li>ul]:my-1 [&_li>ol]:my-1 [&_li_p]:my-1",
	// GFM task lists: drop the bullet next to the checkbox, brand the checkbox with the accent.
	"[&_.task-list-item]:list-none [&_input[type=checkbox]]:mr-xs [&_input[type=checkbox]]:accent-primary",
	// Blockquote — muted with an accent rule (no italic; quotes can be long).
	"[&_blockquote]:my-md [&_blockquote]:border-primary-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-md [&_blockquote]:text-text-muted [&_blockquote>:first-child]:mt-0 [&_blockquote>:last-child]:mb-0",
	// Horizontal rule — a crisp 1px divider.
	"[&_hr]:my-xl [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-border-default",
	// Tables (GFM) — only as wide as content (scroll if wider), bordered cells, header + zebra rows.
	"[&_table]:my-md [&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
	"[&_th]:border [&_th]:border-border-default [&_th]:bg-container-elevated-bg [&_th]:px-sm [&_th]:py-xs [&_th]:text-left",
	"[&_td]:border [&_td]:border-border-default [&_td]:px-sm [&_td]:py-xs [&_td]:align-top",
	"[&_tbody_tr:nth-child(2n)]:bg-sunken",
	// Code blocks — spacing only; size/leading come from the doc prose system.
	"[&_pre]:my-md",
	// Images.
	"[&_img]:my-md [&_img]:max-w-full [&_img]:rounded-[var(--radius-sm)]",
].join(" ");

/**
 * The document pipeline shared by the plain preview and `RenderedDiff`: GFM+shiki via `chat/Markdown`
 * wearing the document prose skin, with alert callouts, heading ids, workspace-aware links/images, and
 * a leading YAML frontmatter block stripped. Pure — also safe under `renderToStaticMarkup`.
 */
export function MarkdownDocument({
	content,
	workspaceId,
	path,
}: {
	content: string;
	workspaceId: string;
	path: string;
}) {
	const components = useMemo(() => documentComponents({ workspaceId, path }), [path, workspaceId]);
	return (
		<Markdown
			text={stripFrontmatter(content)}
			className={DOCUMENT_PROSE}
			remarkPlugins={[remarkGithubAlerts, remarkHeadingIds]}
			components={{ ...alertComponents, ...components }}
		/>
	);
}

/** One thing the preview splices into the document flow: a saved comment's card or the composer. */
interface FlowInsert {
	key: string;
	/** RAW-file anchor line the insert follows. */
	line: number;
	node: React.ReactNode;
}

/**
 * Split the stripped document at each insert's anchor and interleave the in-flow nodes (the
 * inline-edit branch's splice presentation, adopted for comments): each card/composer sits directly
 * below the markdown segment that ends at its anchor line, pushing the rest of the document down. An
 * insert whose line falls outside the text renders after the whole document (never lost). Inserts
 * carry RAW-file lines; the split runs in stripped coordinates (`rawOffset`). Each segment reports its
 * own raw-line stamp offset so `sourceLineRehype` stamps stay in raw coordinates.
 *
 * A cut never divides a multi-line construct: an anchor inside a fenced code block or a GFM table
 * snaps to the construct's last line (`indivisibleSpans` / `snapSplitLine`), so the card lands after
 * the block it comments on and both halves stay whole documents. Half a fence is not a document —
 * the unclosed opener would render the rest of the file as code for as long as the comment lives.
 */
function splicedSegments(
	stripped: string,
	rawOffset: number,
	inserts: FlowInsert[],
): { key: string; text: string; stampOffset: number; nodes: React.ReactNode[] }[] {
	const lines = stripped.split("\n");
	const spans = indivisibleSpans(stripped);
	const ordered = [...inserts].sort((a, b) => a.line - b.line);
	const segments: { key: string; text: string; stampOffset: number; nodes: React.ReactNode[] }[] =
		[];
	let cursor = 0;
	const tail: React.ReactNode[] = [];
	for (const insert of ordered) {
		const anchored = insert.line - rawOffset;
		if (anchored < 1 || anchored > lines.length) {
			tail.push(insert.node);
			continue;
		}
		const end = snapSplitLine(spans, anchored);
		if (end <= cursor) {
			// Same split point as the previous insert — attach to the previous segment's stack.
			const last = segments.at(-1);
			if (last) last.nodes.push(insert.node);
			else tail.push(insert.node);
			continue;
		}
		// Keyed by the split line — stable across re-renders, unique by construction (cursor advances).
		segments.push({
			key: `seg-${end}`,
			text: lines.slice(cursor, end).join("\n"),
			stampOffset: rawOffset + cursor,
			nodes: [insert.node],
		});
		cursor = end;
	}
	segments.push({
		key: "seg-tail",
		text: lines.slice(cursor).join("\n"),
		stampOffset: rawOffset + cursor,
		nodes: tail,
	});
	return segments;
}

/**
 * Rendered markdown view for a `.md` file tab. Owns the document-view chrome (scroll + a centered,
 * padded reading column capped at a comfortable measure); the content is the shared document pipeline.
 * With a `review` (file tabs — not ephemeral docs) the view carries the whole review surface:
 * `PreviewCommenting` becomes the scroller (selection → icon → composer), block elements are stamped
 * with source lines (`sourceLineRehype` — exact anchors for the composer), and saved comments are
 * spliced into the document flow as in-flow cards. Lazy-loaded — the markdown+shiki chunk only arrives
 * when a markdown tab is shown in preview mode.
 */
export default function MarkdownPreview({
	content,
	workspaceId,
	path,
	review,
}: {
	content: string;
	workspaceId: string;
	path: string;
	review?: EditorReview;
}) {
	const components = useMemo(() => documentComponents({ workspaceId, path }), [path, workspaceId]);
	if (!review) {
		return (
			<div
				data-testid="markdown-preview"
				className="h-full overflow-auto bg-container-workspace-bg"
			>
				<article className="mx-auto max-w-[78ch] px-xl py-lg">
					<MarkdownDocument content={content} workspaceId={workspaceId} path={path} />
				</article>
			</div>
		);
	}

	const stripped = stripFrontmatter(content);
	const rawOffset = frontmatterOffset(content, stripped);
	// Tuple form: each segment parses independently (remark restarts at line 1), so its stamps carry
	// the segment's raw-line offset — every stamp downstream is a RAW-file line.
	const mdProps = (stampOffset: number) => ({
		className: DOCUMENT_PROSE,
		remarkPlugins: [remarkGithubAlerts, remarkHeadingIds],
		rehypePlugins: [[sourceLineRehype, { offset: stampOffset }]] as MarkdownRehypePlugins,
		components: { ...alertComponents, ...components },
	});
	const threadInserts: FlowInsert[] = review.threads.map((thread) => ({
		key: thread.id,
		line: thread.endLine,
		node: <ReviewThreadCard key={thread.id} thread={thread} actions={review.actions} />,
	}));
	return (
		<PreviewCommenting source={content} review={review}>
			{(composer: ComposerInsert | null) => {
				const inserts = composer
					? [...threadInserts, { key: "composer", line: composer.line, node: composer.node }]
					: threadInserts;
				const segments = splicedSegments(stripped, rawOffset, inserts);
				return (
					<article className="mx-auto max-w-[78ch] px-xl py-lg">
						{segments.map((segment) => (
							<div key={segment.key}>
								{segment.text && <Markdown text={segment.text} {...mdProps(segment.stampOffset)} />}
								{segment.nodes}
							</div>
						))}
					</article>
				);
			}}
		</PreviewCommenting>
	);
}
