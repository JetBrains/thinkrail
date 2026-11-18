import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsJumpContext } from "../settingsKit";
import { KeybindingEditor } from "./KeybindingEditor";

const groups = (markup: string) =>
	markup.match(/<div[^>]*data-testid="keybinding-group"[^>]*>/g) ?? [];

test("every area starts collapsed, so no shortcut row renders until one is opened", () => {
	const markup = renderToStaticMarkup(<KeybindingEditor />);
	expect(groups(markup).length).toBeGreaterThan(8);
	expect(groups(markup).every((group) => group.includes('aria-expanded="false"'))).toBe(true);
	expect(markup).not.toContain('data-testid="keybinding-row"');
	expect(markup).toContain('data-setting-row="keyboard-filter"');
	expect(markup).toContain('data-setting-id="keyboard-shortcuts"');
});

test("a jump to a shortcut opens only the area holding it, so the jump can reach the row", () => {
	const markup = renderToStaticMarkup(
		<SettingsJumpContext value={{ id: "shortcut:group.splitRight", seq: 1 }}>
			<KeybindingEditor />
		</SettingsJumpContext>,
	);
	const open = groups(markup).filter((group) => group.includes('aria-expanded="true"'));
	expect(open).toHaveLength(1);
	expect(open[0]).toContain('data-area="tabs"');
	expect(markup).toContain('data-setting-id="shortcut:group.splitRight"');
	expect(markup).not.toContain('data-setting-id="shortcut:trees.search"');
});
