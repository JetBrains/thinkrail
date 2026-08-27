import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolCard } from "./ToolCard";
import { registerToolRenderer } from "./toolRegistry";

describe("tool result images", () => {
	it("appends a preview after a registered tool's specialized body", () => {
		registerToolRenderer(
			"registered-image-output",
			() => createElement("span", null, "specialized body"),
			{
				summary: () => "/tmp/tab-overflow-mockups.png",
				defaultExpanded: true,
			},
		);
		const markup = renderToStaticMarkup(
			createElement(ToolCard, {
				toolCallId: "registered-image-call",
				toolName: "registered-image-output",
				args: {},
				tool: {
					status: "done",
					raw: {
						content: [{ type: "image", data: "cG5n", mimeType: "image/png" }],
					},
				},
				streaming: false,
			}),
		);

		expect(markup).toContain("specialized body");
		expect(markup).toContain('data-testid="tool-result-image-thumbnail"');
		expect(markup).toContain('src="data:image/png;base64,cG5n"');
		expect(markup).toContain('aria-label="View /tmp/tab-overflow-mockups.png full screen"');
	});

	it("renders accepted fallback-result images in block order without dumping content JSON", () => {
		const markup = renderToStaticMarkup(
			createElement(ToolCard, {
				toolCallId: "fallback-image-call",
				toolName: "unregistered-image-output",
				args: {},
				tool: {
					status: "error",
					raw: {
						content: [
							{ type: "text", text: "Captured two frames" },
							{ type: "image", data: "Zmlyc3Q=", mimeType: "image/png" },
							{ type: "image", data: "c2Vjb25k", mimeType: "image/jpeg" },
							{ type: "image", data: "PHN2Zz4=", mimeType: "image/svg+xml" },
						],
					},
				},
				streaming: false,
			}),
		);

		expect(markup).toContain("Captured two frames");
		expect(markup).not.toContain("&quot;mimeType&quot;");
		expect(markup.match(/data-testid="tool-result-image-thumbnail"/g)).toHaveLength(2);
		expect(markup.indexOf("data:image/png;base64,Zmlyc3Q=")).toBeLessThan(
			markup.indexOf("data:image/jpeg;base64,c2Vjb25k"),
		);
		expect(markup).not.toContain("data:image/svg+xml");
	});
});
