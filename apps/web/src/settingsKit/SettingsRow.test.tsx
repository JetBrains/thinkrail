import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsRow } from "./SettingsRow";

const render = (changed: boolean | null) =>
	renderToStaticMarkup(
		<SettingsRow
			settingId="chat-line-width"
			label="Chat line width"
			description="Maximum characters per line in chat."
			control={<input aria-label="width" tabIndex={0} />}
			reset={changed === null ? undefined : { changed, onReset: () => {} }}
		/>,
	);

test("a row carries its walk and jump markup and a control slot", () => {
	const markup = render(false);
	expect(markup).toContain('data-setting-row="chat-line-width"');
	expect(markup).toContain('data-setting-id="chat-line-width"');
	expect(markup).toContain("data-setting-control");
	expect(markup).toContain("Maximum characters per line in chat.");
});

test("an unchanged row shows neither Changed nor Reset", () => {
	for (const markup of [render(false), render(null)]) {
		expect(markup).not.toContain("Changed");
		expect(markup).not.toContain("data-setting-reset");
		expect(markup).not.toContain("data-changed");
	}
});

test("a changed row shows a visible Changed tag and a tabbable Reset side", () => {
	const markup = render(true);
	expect(markup).toContain("Changed");
	expect(markup).toContain('data-changed="true"');
	const reset = markup.match(/<button[^>]*data-setting-reset[^>]*>/)?.[0] ?? "";
	expect(reset).toContain("data-setting-side");
	expect(reset).toContain('tabindex="0"');
	expect(reset).toContain('aria-label="Reset Chat line width to default"');
	expect(reset).toContain('data-testid="settings-reset-chat-line-width"');
	expect(markup).toMatch(/data-setting-reset[^>]*>.*Reset<\/button>/);
});

test("a row id other than the setting id names the walk row", () => {
	const markup = renderToStaticMarkup(
		<SettingsRow rowId="status" label="Status" control={<span>ok</span>} />,
	);
	expect(markup).toContain('data-setting-row="status"');
	expect(markup).not.toContain("data-setting-id");
});
