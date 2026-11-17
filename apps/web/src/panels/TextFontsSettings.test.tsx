import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TextFontsSettings } from "./TextFontsSettings";

test("Text & fonts shows both line widths, each with its own Fit to pane switch", () => {
	const markup = renderToStaticMarkup(<TextFontsSettings />);
	expect(markup).toContain('data-testid="settings-text"');
	for (const kind of ["chat", "file"]) {
		expect(markup.match(new RegExp(`data-testid="${kind}-line-width-input"`, "g"))).toHaveLength(1);
		expect(markup).toMatch(
			new RegExp(`<button[^>]*role="switch"[^>]*data-testid="${kind}-line-width-bounded"`),
		);
		expect(markup).not.toContain(`data-testid="${kind}-line-width-error"`);
	}
	expect(markup.indexOf("chat-line-width-input")).toBeLessThan(
		markup.indexOf("file-line-width-input"),
	);
});

test("Text & fonts hides the font groups from a host that does not store fonts", () => {
	expect(renderToStaticMarkup(<TextFontsSettings />)).not.toContain("font-code-size");
});
