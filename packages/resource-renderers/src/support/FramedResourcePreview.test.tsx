import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceEnvironmentProvider } from "../host";
import { HtmlFrame } from "../renderers/html/HtmlFrame";
import { HtmlPreviewNotice } from "../renderers/html/ViewportSwitch";
import { FramedResourcePreview } from "./FramedResourcePreview";

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
