import { describe, expect, test } from "bun:test";
import { RiCheckLine } from "@remixicon/react";
import { renderToStaticMarkup } from "react-dom/server";

describe("@remixicon/react integration", () => {
	test("a Remix icon imports and renders an svg, coloured by a semantic utility", () => {
		const markup = renderToStaticMarkup(<RiCheckLine className="text-feedback-success" />);
		expect(markup).toContain("<svg");
		expect(markup).toContain("text-feedback-success");
		expect(markup).toContain('fill="currentColor"');
	});
});
