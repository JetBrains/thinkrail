import { stripFrontmatter } from "@/lib/utils";
import { Markdown } from "../chat/Markdown";

/**
 * Document "prose skin" for the file-tab rendered view. Reading-optimized typography modeled on the
 * values GitHub's markdown CSS settled on (and that Zed / IntelliJ previews converge toward), expressed
 * with our theme-token utilities so it wears any theme:
 *  - Heading hierarchy is **em-relative** (h1 2em … h6 .85em) with fixed top/bottom margins + h1/h2 rules,
 *    so the scale holds whatever the base size is.
 *  - Reading measure is capped (~78ch) for a comfortable line length; wide tables/code blocks scroll
 *    within the column instead of stretching the prose.
 *  - Tables are zebra-striped with bordered cells + a semibold header; blockquotes are muted (not
 *    italic); code blocks tighten their line-height. Code sizing is `em` (see `Markdown`), so it tracks
 *    the base font.
 */
const DOCUMENT_PROSE = [
	"max-w-none break-words text-[length:var(--font-md)] leading-[1.65] text-pretty text-text",
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
	// Headings — em-relative sizes; fixed margins (bigger top than bottom); h1/h2 get a section rule.
	"[&_h1]:mt-0 [&_h1]:mb-md [&_h1]:border-border2 [&_h1]:border-b [&_h1]:pb-xs [&_h1]:font-semibold [&_h1]:text-[2em] [&_h1]:leading-tight [&_h1]:text-balance",
	"[&_h2]:mt-xl [&_h2]:mb-md [&_h2]:border-border2 [&_h2]:border-b [&_h2]:pb-xs [&_h2]:font-semibold [&_h2]:text-[1.5em] [&_h2]:leading-tight [&_h2]:text-balance",
	"[&_h3]:mt-lg [&_h3]:mb-sm [&_h3]:font-semibold [&_h3]:text-[1.25em] [&_h3]:leading-snug [&_h3]:text-balance",
	"[&_h4]:mt-lg [&_h4]:mb-sm [&_h4]:font-semibold [&_h4]:text-[1em] [&_h4]:text-balance",
	"[&_h5]:mt-md [&_h5]:mb-xs [&_h5]:font-semibold [&_h5]:text-[0.875em]",
	"[&_h6]:mt-md [&_h6]:mb-xs [&_h6]:font-semibold [&_h6]:text-[0.85em] [&_h6]:text-muted",
	// Body text + inline emphasis.
	"[&_p]:my-md [&_strong]:font-semibold [&_strong]:text-text",
	"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary/40 hover:[&_a]:decoration-primary",
	// Lists — GitHub's ~2em indent + tight item spacing; nested lists tighten further.
	"[&_ul]:my-md [&_ul]:list-disc [&_ul]:pl-[1.6em] [&_ol]:my-md [&_ol]:list-decimal [&_ol]:pl-[1.6em] [&_li]:my-1",
	"[&_li>ul]:my-1 [&_li>ol]:my-1 [&_li_p]:my-1",
	// GFM task lists: drop the bullet next to the checkbox, brand the checkbox with the accent.
	"[&_.task-list-item]:list-none [&_input[type=checkbox]]:mr-xs [&_input[type=checkbox]]:accent-primary",
	// Blockquote — muted with an accent rule (no italic; quotes can be long).
	"[&_blockquote]:my-md [&_blockquote]:border-primary/50 [&_blockquote]:border-l-2 [&_blockquote]:pl-md [&_blockquote]:text-muted [&_blockquote>:first-child]:mt-0 [&_blockquote>:last-child]:mb-0",
	// Horizontal rule — a crisp 1px divider.
	"[&_hr]:my-xl [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-border2",
	// Tables (GFM) — only as wide as content (scroll if wider), bordered cells, header + zebra rows.
	"[&_table]:my-md [&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[0.9em]",
	"[&_th]:border [&_th]:border-border2 [&_th]:bg-elevated [&_th]:px-sm [&_th]:py-xs [&_th]:text-left [&_th]:font-semibold",
	"[&_td]:border [&_td]:border-border2 [&_td]:px-sm [&_td]:py-xs [&_td]:align-top",
	"[&_tbody_tr:nth-child(2n)]:bg-elevated/30",
	// Code blocks — tighten the line-height for dense code (inline/block sizing lives in `Markdown`).
	"[&_pre]:my-md [&_pre]:leading-normal",
	// Images.
	"[&_img]:my-md [&_img]:max-w-full [&_img]:rounded-[var(--radius-md)]",
].join(" ");

/**
 * Rendered markdown view for a `.md` file tab. Owns the document-view chrome (scroll + a centered,
 * padded reading column capped at a comfortable measure + the document skin); the GFM+shiki rendering is
 * the reused `chat/Markdown`. Lazy-loaded — the markdown+shiki chunk only arrives when a markdown tab is
 * shown in preview mode.
 */
export default function MarkdownPreview({ content }: { content: string }) {
	return (
		<div data-testid="markdown-preview" className="h-full overflow-auto bg-surface-content">
			<article className="mx-auto max-w-[78ch] px-xl py-lg">
				<Markdown text={stripFrontmatter(content)} className={DOCUMENT_PROSE} />
			</article>
		</div>
	);
}
