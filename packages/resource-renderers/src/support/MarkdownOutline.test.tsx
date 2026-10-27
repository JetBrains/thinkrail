import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { type ReactNode, type RefObject, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ResourceHost, ResourceHostProvider, ResourcePreferencesProvider } from "../host";
import type { ResourceViewProps } from "../registry";
import { TestMarkdown as Markdown, testLinks } from "../testing/markdown";
import { MarkdownOutline } from "./MarkdownOutline";
import MarkdownPreview from "./MarkdownPreview";
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
