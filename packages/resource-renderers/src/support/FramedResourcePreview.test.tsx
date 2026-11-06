import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceEnvironmentProvider } from "../host";
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
