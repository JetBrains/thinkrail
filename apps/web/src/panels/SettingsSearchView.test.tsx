import { expect, test } from "bun:test";
import { RiChat2Line } from "@remixicon/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsSection } from "@/store";
import { SettingsSearchField, SettingsSearchResults } from "./SettingsSearchView";
import { searchSettings } from "./settingsSearch";

const labels = new Map([
	[SettingsSection.Chat, "Chat"],
	[SettingsSection.Text, "Text & fonts"],
]);
const entries = [
	{ id: "message-order", section: SettingsSection.Chat, label: "Message order" },
	{
		id: "chat-line-width",
		section: SettingsSection.Text,
		label: "Chat line width",
		description: "Maximum characters per line in chat.",
	},
];

const results = (query: string, active = 0) =>
	renderToStaticMarkup(
		<SettingsSearchResults
			query={query}
			results={searchSettings(query, entries, labels)}
			active={active}
			icons={new Map([[SettingsSection.Chat, RiChat2Line]])}
			onActive={() => {}}
			onJump={() => {}}
			onKeyDown={() => {}}
		/>,
	);

test("results are options with their section as a breadcrumb, highlighted matches and a count", () => {
	const html = results("chat", 1);
	expect(html).toContain("2 results");
	expect(html).toContain("for “chat” in all sections");
	expect(html).toContain('role="listbox"');
	expect(html.match(/role="option"/g)).toHaveLength(2);
	expect(html.match(/tabindex="0"/g)).toHaveLength(1);
	expect(html).toContain('data-result-id="message-order" data-result-index="1"');
	expect(html).toMatch(/data-result-id="message-order"[^>]*>.*<mark[^>]*>Chat<\/mark>/);
	expect(html).toContain("Text &amp; fonts");
	expect(html).toContain("Maximum characters per line in chat.");
	expect(html).toContain("data-settings-search");
});

test("a query that matches nothing says so, with a way back", () => {
	const html = results("zzz");
	expect(html).toContain("0 results");
	expect(html).toContain("No settings match “zzz”");
	expect(html).not.toContain('role="listbox"');
});

test("the field is labelled Search settings and shows its S hint", () => {
	const html = renderToStaticMarkup(
		<SettingsSearchField query="" onQuery={() => {}} onKeyDown={() => {}} onFocus={() => {}} />,
	);
	expect(html).toContain('placeholder="Search settings"');
	expect(html).toContain('aria-label="Search settings"');
	expect(html).toContain('tabindex="0"');
	expect(html).toMatch(/<kbd[^>]*>S<\/kbd>/);
	expect(html).toContain("data-settings-search");
});
