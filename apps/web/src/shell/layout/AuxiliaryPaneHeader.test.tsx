import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AuxiliaryPaneHeader } from "./AuxiliaryPaneHeader";

describe("AuxiliaryPaneHeader title", () => {
	it("truncates the title text inside the flex box, so the ellipsis shows", () => {
		const html = renderToStaticMarkup(<AuxiliaryPaneHeader title="A long pane title" />);
		const title = html.match(
			/<span data-testid="auxiliary-pane-title" class="([^"]*)"><span class="([^"]*)">A long pane title<\/span><\/span>/,
		);

		expect(title).not.toBeNull();
		const [, outer = "", inner = ""] = title ?? [];
		expect(outer.split(" ")).toContain("flex");
		expect(outer.split(" ")).not.toContain("truncate");
		expect(inner.split(" ")).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
	});
});
