import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsSection } from "@/store";
import { SettingsTabs, settingsTabId, settingsTabOrder } from "./SettingsTabs";
import { settingsNavGroups } from "./settingsNav";

const groups = settingsNavGroups(PROTOCOL_VERSION, false);

const markup = (selected: SettingsSection, searching = false) =>
	renderToStaticMarkup(
		<SettingsTabs
			groups={groups}
			selected={selected}
			searching={searching}
			onSelect={() => {}}
			onEnter={() => {}}
			onSearch={() => {}}
		/>,
	);

describe("the Settings section tabs", () => {
	test("the arrows walk the nav order, with Share feedback last", () => {
		const order = settingsTabOrder(groups);
		expect(order[0]).toBe(SettingsSection.Models);
		expect(order.at(-1)).toBe(SettingsSection.Feedback);
		expect(order.indexOf(SettingsSection.Text)).toBe(order.indexOf(SettingsSection.Appearance) + 1);
		expect(order).not.toContain(SettingsSection.Updates);
		expect(new Set(order).size).toBe(order.length);
	});

	test("one vertical tablist with one tab stop on the selected tab; every tab keeps its testid", () => {
		const html = markup(SettingsSection.Chat);
		expect(html).toContain('role="tablist"');
		expect(html).toContain('aria-orientation="vertical"');
		expect(html).toContain('data-key-scope="settings.nav"');
		expect(html.match(/role="tab"/g)).toHaveLength(settingsTabOrder(groups).length);
		expect(html.match(/tabindex="0"/g)).toHaveLength(1);
		expect(html).toMatch(
			new RegExp(
				`id="${settingsTabId(SettingsSection.Chat)}" aria-selected="true"[^>]*tabindex="0"`,
			),
		);
		expect(html).toContain('data-testid="settings-nav-feedback"');
		expect(html).toContain('data-testid="settings-nav-chat" data-active="true"');
		expect(html).toContain('data-testid="settings-nav-models" data-active="false"');
		expect(html).toContain('aria-controls="settings-panel"');
	});

	test("Share feedback is a tab like the others and can hold the selection", () => {
		const html = markup(SettingsSection.Feedback, true);
		expect(html).toContain('data-testid="settings-nav-feedback" data-active="true"');
		expect(html.match(/tabindex="-1"/g)).toHaveLength(settingsTabOrder(groups).length - 1);
	});
});
