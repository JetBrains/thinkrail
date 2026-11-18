import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { activeListRow, SettingsList, useSettingsListRow } from "./SettingsList";

function Row({ id }: { id: string }) {
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(id);
	return (
		<li {...rowProps}>
			<button type="button" {...primaryProps}>
				{id}
			</button>
			<button type="button" aria-label="menu" {...sideProps} />
		</li>
	);
}

const ROWS = ["context7", "linear"];

const markup = renderToStaticMarkup(
	<SettingsList
		focusList="mcp:user"
		label="User servers"
		rowIds={ROWS}
		settingId="mcp-user-servers"
	>
		{ROWS.map((id) => (
			<Row key={id} id={id} />
		))}
	</SettingsList>,
);

test("a list carries the focus-recovery markup and its key scope", () => {
	const list = markup.match(/<ul[^>]*>/)?.[0] ?? "";
	expect(list).toContain('data-focus-list="mcp:user"');
	expect(list).toContain('data-key-scope="settings.list"');
	expect(list).toContain('data-setting-id="mcp-user-servers"');
	expect(list).toContain('aria-label="User servers"');
	for (const id of ROWS) {
		expect(markup).toContain(`data-focus-row="${id}"`);
		expect(markup).toContain(`data-setting-row="mcp:user/${id}"`);
	}
	expect(markup.match(/data-focus-row-primary/g)).toHaveLength(2);
	expect(markup.match(/data-setting-stop/g)).toHaveLength(2);
});

test("only the active row's primary and sides are tab stops, and each renders a tabindex", () => {
	const buttons = markup.match(/<button[^>]*>/g) ?? [];
	expect(buttons.map((button) => /tabindex="(-?\d)"/.exec(button)?.[1])).toEqual([
		"0",
		"0",
		"-1",
		"-1",
	]);
	expect(buttons[1]).toContain("data-setting-side");
});

test("the active row is the focused one while it exists, else the first", () => {
	expect(activeListRow(ROWS, "linear")).toBe("linear");
	expect(activeListRow(ROWS, "gone")).toBe("context7");
	expect(activeListRow(ROWS, null)).toBe("context7");
	expect(activeListRow([], null)).toBeNull();
});
