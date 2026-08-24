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

const DOCUMENT_PROSE = [
	"tr-prose-doc max-w-none break-words text-pretty text-text-default",
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
	"[&_h1]:mt-0 [&_h1]:mb-12 [&_h1]:border-border-default [&_h1]:border-b [&_h1]:pb-4 [&_h1]:text-balance",
	"[&_h2]:mt-24 [&_h2]:mb-12 [&_h2]:border-border-default [&_h2]:border-b [&_h2]:pb-4 [&_h2]:text-balance",
	"[&_h3]:mt-16 [&_h3]:mb-8 [&_h3]:text-balance",
	"[&_h4]:mt-16 [&_h4]:mb-8 [&_h4]:text-balance",
	"[&_h5]:mt-12 [&_h5]:mb-4",
	"[&_h6]:mt-12 [&_h6]:mb-4 [&_h6]:text-text-muted",
	"[&_p]:my-12 [&_strong]:text-text-default",
	"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary-muted hover:[&_a]:decoration-primary",
	"[&_ul]:my-12 [&_ul]:list-disc [&_ul]:pl-[1.6em] [&_ol]:my-12 [&_ol]:list-decimal [&_ol]:pl-[1.6em] [&_li]:my-4",
	"[&_li>ul]:my-4 [&_li>ol]:my-4 [&_li_p]:my-4",
	"[&_.task-list-item]:list-none [&_input[type=checkbox]]:mr-4 [&_input[type=checkbox]]:accent-primary",
	"[&_blockquote]:my-12 [&_blockquote]:border-primary-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-12 [&_blockquote]:text-text-muted [&_blockquote>:first-child]:mt-0 [&_blockquote>:last-child]:mb-0",
	"[&_hr]:my-24 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-border-default",
	"[&_table]:my-12 [&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
	"[&_th]:border [&_th]:border-border-default [&_th]:bg-container-elevated-bg [&_th]:px-8 [&_th]:py-4 [&_th]:text-left",
	"[&_td]:border [&_td]:border-border-default [&_td]:px-8 [&_td]:py-4 [&_td]:align-top",
	"[&_tbody_tr:nth-child(2n)]:bg-sunken",
	"[&_pre]:my-12",
	"[&_img]:my-12 [&_img]:max-w-full [&_img]:rounded-[var(--radius-sm)]",
].join(" ");

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

interface FlowInsert {
	key: string;
	line: number;
	node: React.ReactNode;
}

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
			const last = segments.at(-1);
			if (last) last.nodes.push(insert.node);
			else tail.push(insert.node);
			continue;
		}
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
				<article className="mx-auto max-w-[78ch] px-24 py-16">
					<MarkdownDocument content={content} workspaceId={workspaceId} path={path} />
				</article>
			</div>
		);
	}

	const stripped = stripFrontmatter(content);
	const rawOffset = frontmatterOffset(content, stripped);
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
					<article className="mx-auto max-w-[78ch] px-24 py-16">
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
