import { stripFrontmatter } from "@/lib/utils";
import { Markdown } from "../chat/Markdown";
import { alertComponents, remarkGithubAlerts } from "./markdownAlerts";
import { documentComponents, remarkHeadingIds } from "./markdownLinks";

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
	"[&_img]:my-md [&_img]:max-w-full [&_img]:rounded-[var(--radius-md)]",
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
	return (
		<Markdown
			text={stripFrontmatter(content)}
			className={DOCUMENT_PROSE}
			remarkPlugins={[remarkGithubAlerts, remarkHeadingIds]}
			components={{ ...alertComponents, ...documentComponents({ workspaceId, path }) }}
		/>
	);
}

/**
 * Rendered markdown view for a `.md` file tab. Owns the document-view chrome (scroll + a centered,
 * padded reading column capped at a comfortable measure); the content is the shared `MarkdownDocument`.
 * Lazy-loaded — the markdown+shiki chunk only arrives when a markdown tab is shown in preview mode.
 */
export default function MarkdownPreview({
	content,
	workspaceId,
	path,
}: {
	content: string;
	workspaceId: string;
	path: string;
}) {
	return (
		<div data-testid="markdown-preview" className="h-full overflow-auto bg-container-content-bg">
			<article className="mx-auto max-w-[78ch] px-xl py-lg">
				<MarkdownDocument content={content} workspaceId={workspaceId} path={path} />
			</article>
		</div>
	);
}
