import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomFontsView } from "./CustomFontsSettings";
import { LineWidthCard } from "./LineWidthSettings";
import { TextFontsSettings } from "./TextFontsSettings";

const save = () => Promise.resolve(true);

describe("Text & fonts", () => {
	test("is a titled page with the Line width group: Chat and Files & diffs side by side", () => {
		const markup = renderToStaticMarkup(<TextFontsSettings />);
		expect(markup).toContain('data-testid="settings-text"');
		expect(markup).toMatch(/<h2[^>]*>Text &amp; fonts<\/h2>/);
		expect(markup).toContain("@md:grid-cols-2");
		for (const kind of ["chat", "file"]) {
			expect(markup.match(new RegExp(`data-testid="${kind}-line-width-input"`, "g"))).toHaveLength(
				1,
			);
			expect(markup).toMatch(
				new RegExp(`<button[^>]*role="switch"[^>]*data-testid="${kind}-line-width-bounded"`),
			);
		}
		expect(markup.indexOf("chat-line-width-control")).toBeLessThan(
			markup.indexOf("file-line-width-control"),
		);
		expect(markup).toContain("Files &amp; diffs");
		expect(markup).not.toContain("data-changed");
	});

	test("hides the font groups from a host that does not store fonts", () => {
		const markup = renderToStaticMarkup(<TextFontsSettings />);
		expect(markup).not.toContain("font-code-size");
		expect(markup).not.toContain("custom-fonts");
	});
});

describe("the line width cards", () => {
	test("each card's width and Fit to pane reset on their own, apart from the other card", () => {
		const chat = renderToStaticMarkup(
			<LineWidthCard kind="chat" value={100} bounded={false} onSave={save} />,
		);
		const file = renderToStaticMarkup(
			<LineWidthCard kind="file" value={120} bounded onSave={save} />,
		);
		expect(chat).toContain('data-testid="settings-reset-chat-line-width"');
		expect(chat).toContain('data-testid="settings-reset-chat-fit-to-pane"');
		expect(chat.match(/data-changed="true"/g)).toHaveLength(2);
		expect(file).not.toContain("settings-reset-");
		expect(file).not.toContain("data-changed");

		const width = renderToStaticMarkup(
			<LineWidthCard kind="file" value={160} bounded onSave={save} />,
		);
		expect(width).toContain('data-testid="settings-reset-file-line-width"');
		expect(width).not.toContain("settings-reset-file-fit-to-pane");
	});

	test("a card names its pane and keeps the widths' input and switch names apart", () => {
		const chat = renderToStaticMarkup(
			<LineWidthCard kind="chat" value={80} bounded onSave={save} />,
		);
		expect(chat).toContain('data-setting-id="chat-line-width"');
		expect(chat).toContain('data-setting-id="chat-fit-to-pane"');
		expect(chat).toMatch(
			/<section aria-labelledby="[^"]+"[^>]*data-testid="chat-line-width-control"/,
		);
		const input = chat.match(/<input[^>]*data-testid="chat-line-width-input"[^>]*>/)?.[0];
		expect(input).toContain('aria-label="Chat line width"');
		expect(input).toContain('inputMode="numeric"');
		expect(input).toContain('value="80"');
		expect(chat).toContain('aria-label="Fit chat line width to pane"');
		expect(chat).toContain("chars");
	});
});

describe("custom fonts", () => {
	const view = (files: Parameters<typeof CustomFontsView>[0]["snapshot"]["files"]) =>
		renderToStaticMarkup(
			<CustomFontsView
				snapshot={{ dir: "/home/me/.thinkrail/fonts", files }}
				inUse={new Set()}
				outcomes={[]}
				busy={false}
				onFiles={() => {}}
				onCopyFolder={() => {}}
				onRevealFolder={() => {}}
			/>,
		);

	test("an empty folder shows an empty state whose Choose files is the row's stop", () => {
		const markup = view([]);
		expect(markup).toContain("No custom fonts yet.");
		expect(markup).toContain('data-setting-id="custom-fonts"');
		expect(markup).toMatch(
			/<button[^>]*tabindex="0"[^>]*data-setting-stop=""[^>]*data-testid="custom-fonts-choose"/,
		);
		expect(markup).not.toContain('data-testid="custom-font-family"');
		expect(markup).toContain('data-setting-id="fonts-folder"');
		expect(markup).toContain('data-testid="custom-fonts-open-folder"');
	});

	test("added fonts are listed by family under the drop zone", () => {
		const markup = view([
			{
				fileName: "Fixture-Regular.ttf",
				ok: true,
				url: "/fonts/Fixture-Regular.ttf",
				face: {
					family: "Fixture Sans",
					weight: { min: 400, max: 400 },
					style: "normal",
					monospace: false,
				},
			},
		]);
		expect(markup).not.toContain("No custom fonts yet.");
		expect(markup).toContain("Drop font files here");
		expect(markup).toMatch(
			/<li[^>]*data-testid="custom-font-family"[^>]*data-font-family="Fixture Sans"/,
		);
		expect(markup).toContain("Fixture-Regular.ttf");
	});
});
