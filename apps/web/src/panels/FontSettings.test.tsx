import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FontSettings } from "./FontSettings";

test("offers three independently labelled font inputs, reset buttons and previews", () => {
	const html = renderToStaticMarkup(<FontSettings />);
	for (const kind of ["interface", "code", "terminal"]) {
		expect(html).toContain(`data-testid="font-${kind}-input"`);
		expect(html).toContain(`data-testid="font-${kind}-reset"`);
		expect(html).toContain(`data-testid="font-${kind}-preview"`);
	}
	expect(html).toContain('aria-label="UI font"');
	expect(html).toContain('aria-label="Code font"');
	expect(html).toContain('aria-label="Terminal font"');
	expect(html).toContain("Saved only in this client");
	expect(html).toContain("tr-code-terminal");
});
