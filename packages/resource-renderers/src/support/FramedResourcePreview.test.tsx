import { describe, expect, it } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ResourceEnvironmentProvider,
	type ResourceHost,
	ResourceHostProvider,
	ResourceScopeProvider,
} from "../host";
import { HtmlFrame } from "../renderers/html/HtmlFrame";
import { HtmlPreviewNotice } from "../renderers/html/ViewportSwitch";
import { FramedResourcePreview, PeekAction } from "./FramedResourcePreview";

const host: ResourceHost = {
	markdown: () => null,
	code: {
		languages: [],
		languageId: () => null,
		pierreTheme: { name: "test", appearance: "dark", style: {} },
		editorTheme: () => ({ rules: [], colors: {} }),
	},
	bytesUrl: () => "",
	openFile: () => {},
	openComparison: () => {},
	readFile: async () => ({ content: "" }),
	subscribeFileChanges: () => () => {},
	FileReview: () => null,
	ReviewSend: () => null,
};

describe("FramedResourcePreview", () => {
	it("renders nothing without a host and a workspace scope", () => {
		expect(
			renderToStaticMarkup(
				<FramedResourcePreview
					path="mockups/a.html"
					title="mockups/a.html"
					frameClassName="h-[380px]"
					testIdPrefix="test-preview"
				/>,
			),
		).toBe("");
	});
});

describe("compact chrome", () => {
	const notice = (compact: boolean) =>
		renderToStaticMarkup(
			<ResourceEnvironmentProvider value={{ mobile: false, compact }}>
				<HtmlPreviewNotice viewport="responsive" onViewport={() => {}} />
			</ResourceEnvironmentProvider>,
		);

	it("drops the HTML viewport presets and notice in a compact frame", () => {
		expect(notice(false)).toContain('data-testid="html-viewport"');
		expect(notice(true)).toBe("");
	});
});

describe("frame focus", () => {
	const frame = (frameFocus?: "auto" | "manual") =>
		renderToStaticMarkup(
			<HtmlFrame title="mockup" document="<p>mockup</p>" frameFocus={frameFocus} />,
		);

	it("keeps an HTML frame in the Tab order unless its host enters it by hand", () => {
		expect(frame()).not.toContain("tabindex");
		expect(frame("auto")).not.toContain("tabindex");
		expect(frame("manual")).toContain('tabindex="-1"');
	});
});

describe("Peek action", () => {
	const action = (value: ResourceHost, before?: string) =>
		renderToStaticMarkup(
			<TooltipProvider>
				<ResourceHostProvider value={value}>
					<ResourceScopeProvider value={{ workspaceId: "w1", sessionId: "s1" }}>
						<PeekAction path="mockups/a.html" before={before} testIdPrefix="test-preview" />
					</ResourceScopeProvider>
				</ResourceHostProvider>
			</TooltipProvider>,
		);

	it("is offered only by a host that peeks, so Peek's own host never offers it", () => {
		expect(action(host)).toBe("");
		const peeking = action({ ...host, peek: () => {} });
		expect(peeking).toContain('data-testid="test-preview-peek"');
		expect(peeking).toContain('aria-label="Open in Peek"');
		expect(peeking).toContain('tabindex="0"');
	});

	it("names a before/after as a diff", () => {
		expect(action({ ...host, peek: () => {} }, "mockups/b.html")).toContain(
			'aria-label="Open diff in Peek"',
		);
	});
});
