import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { type ReactNode, type RefObject, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ResourceHost, ResourceHostProvider, ResourcePreferencesProvider } from "../host";
import type { ResourceViewProps } from "../registry";
import { TestMarkdown as Markdown, testLinks } from "../testing/markdown";
import { MarkdownOutline } from "./MarkdownOutline";
import MarkdownPreview, { MarkdownSplicedArticle } from "./MarkdownPreview";
import { alertComponents } from "./markdownAlerts";
import { activeHeadingId, extractMarkdownOutline, scrollHeadingIntoView } from "./outlineHeadings";

function render(node: ReactNode): string {
	return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
}

const headings = extractMarkdownOutline(`# Alpha

## Beta

# Gamma
`);

const scrollerRef: RefObject<HTMLDivElement | null> = { current: null };

test("the outline renders nested heading entries", () => {
	const html = render(
		<MarkdownOutline headings={headings} open scrollerRef={scrollerRef} onOpenChange={() => {}} />,
	);
	expect(html).toContain('data-testid="markdown-outline"');
	expect(html).toContain('data-id="alpha"');
	expect(html).toContain('data-id="beta"');
	expect(html).toContain('data-id="gamma"');
	expect(html).toContain("Alpha");
	expect(html).toContain("Beta");
	expect(html).toContain('aria-label="Hide outline"');
});

test("clicking an entry scrolls its heading in the preview scroller", () => {
	const selectors: string[] = [];
	const scrolledTo: number[] = [];
	const heading = { getBoundingClientRect: () => ({ top: 240 }) };
	const scroller = {
		scrollTop: 10,
		getBoundingClientRect: () => ({ top: 40 }),
		querySelector: (selector: string) => {
			selectors.push(selector);
			return selector.includes("beta") ? heading : null;
		},
		scrollTo: (options: { top: number }) => {
			scrolledTo.push(options.top);
		},
	} as unknown as HTMLDivElement;
	const html = render(
		<MarkdownOutline
			headings={headings}
			open
			scrollerRef={{ current: scroller }}
			onOpenChange={() => {}}
		/>,
	);
	expect(html).toContain('data-id="beta"');
	expect(html).toContain("markdown-outline-entry");
	scrollHeadingIntoView(scroller, "beta");
	expect(selectors.some((selector) => selector.includes("beta"))).toBe(true);
	expect(scrolledTo).toEqual([210]);
});

test("the active entry follows a simulated scroll", () => {
	const scroller = {
		getBoundingClientRect: () => ({ top: 0 }),
		querySelector: (selector: string) => {
			const top = selector.includes("gamma") ? -4 : selector.includes("beta") ? -20 : -40;
			return { getBoundingClientRect: () => ({ top }) };
		},
	} as unknown as HTMLElement;
	expect(activeHeadingId(scroller, ["alpha", "beta", "gamma"])).toBe("gamma");
});

test("the toggle hides the outline", () => {
	function Harness({ open }: { open: boolean }) {
		const [visible, setVisible] = useState(open);
		return (
			<MarkdownOutline
				headings={headings}
				open={visible}
				scrollerRef={scrollerRef}
				onOpenChange={setVisible}
			/>
		);
	}
	const shown = render(<Harness open />);
	expect(shown).toContain('data-testid="markdown-outline"');
	expect(shown).toContain('aria-pressed="true"');
	const hidden = render(<Harness open={false} />);
	expect(hidden).not.toContain('data-testid="markdown-outline"');
	expect(hidden).toContain('data-testid="markdown-outline-toggle"');
	expect(hidden).toContain('aria-label="Show outline"');
	expect(hidden).toContain('aria-pressed="false"');
});

const host: ResourceHost = {
	markdown: Markdown,
	code: { languages: [], languageId: () => null, theme: () => ({ name: "test", settings: [] }) },
	bytesUrl: testLinks.bytesUrl,
	openFile: testLinks.openFile,
	openComparison: () => {},
	readFile: async () => ({ content: "" }),
	subscribeFileChanges: () => () => {},
	FileReview: () => null,
	ReviewSend: () => null,
};

function preview(text: string, outlineVisible: boolean | null = true) {
	const props: ResourceViewProps = {
		resource: { workspaceId: "ws", path: "DOC.md", text: true },
		content: { kind: "text", text, hash: "h" },
	};
	return render(
		<ResourceHostProvider value={host}>
			<ResourcePreferencesProvider
				value={{
					fileLineWidth: 120,
					fileLineWidthBounded: true,
					markdownOutlineVisible: outlineVisible,
					setMarkdownOutlineVisible: () => {},
				}}
			>
				<MarkdownPreview {...props} />
			</ResourcePreferencesProvider>
		</ResourceHostProvider>,
	);
}

test("a document with fewer than two headings has no outline and no toggle", () => {
	const html = preview("# Only one\n\nbody\n");
	expect(html).toContain('data-testid="markdown-preview"');
	expect(html).not.toContain('data-testid="markdown-outline"');
	expect(html).not.toContain('data-testid="markdown-outline-toggle"');
});

test("a multi-heading preview shows the outline when the preference is open", () => {
	const html = preview("# One\n\n## Two\n");
	expect(html).toContain('data-testid="markdown-outline"');
	expect(html).toContain('data-id="one"');
	expect(html).toContain('data-id="two"');
});

test("a closed preference hides the outline and keeps the toggle", () => {
	const html = preview("# One\n\n## Two\n", false);
	expect(html).toContain('data-testid="markdown-preview"');
	expect(html).not.toContain('data-testid="markdown-outline"');
	expect(html).toContain('data-testid="markdown-outline-toggle"');
	expect(html).toContain('aria-label="Show outline"');
});

test("footnote headings in the preview keep GFM ids", () => {
	const html = preview(`# Details [^note]\n\n[^note]: a footnote\n\n# Details\n`);
	expect(html).toContain('data-id="details"');
	expect(html).toContain('data-id="details-1"');
	expect(html).not.toContain('data-id="details-note"');
	expect(html).toContain('id="user-content-details"');
	expect(html).toContain('id="user-content-details-1"');
});

test("unicode headings appear in the outline with nonempty ids", () => {
	const html = preview("# 中文\n\n## 日本語\n");
	expect(html).toContain('data-testid="markdown-outline"');
	expect(html).toContain('data-id="中文"');
	expect(html).toContain('data-id="日本語"');
	expect(html).toContain('id="user-content-中文"');
	expect(html).toContain('id="user-content-日本語"');
});

test("a review comment between duplicate headings keeps distinct heading ids", () => {
	const markdown = `## Repeat

between

## Repeat
`;
	const html = render(
		<MarkdownSplicedArticle
			content={markdown}
			headings={extractMarkdownOutline(markdown)}
			Markdown={Markdown}
			components={alertComponents}
			inserts={[
				{ key: "thread-1", line: 3, node: <div key="thread-1" data-testid="review-thread-card" /> },
			]}
		/>,
	);
	expect(html).toContain('id="user-content-repeat"');
	expect(html).toContain('id="user-content-repeat-1"');
	expect(html.match(/id="user-content-repeat"/g)?.length).toBe(1);
	expect(html).toContain('data-testid="review-thread-card"');
});
