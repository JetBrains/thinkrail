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
	expect(markup.match(/data-setting-primary/g)).toHaveLength(2);
	expect(markup).not.toContain("data-focus-row-primary");
});

test("each row is a focusable walk stop; only the active row's primary and buttons are tab stops", () => {
	const rows = markup.match(/<li[^>]*>/g) ?? [];
	expect(rows.map((row) => /tabindex="(-?\d)"/.exec(row)?.[1])).toEqual(["-1", "-1"]);
	const buttons = markup.match(/<button[^>]*>/g) ?? [];
	expect(buttons.map((button) => /tabindex="(-?\d)"/.exec(button)?.[1])).toEqual([
		"0",
		"0",
		"-1",
		"-1",
	]);
});

test("the active row is the focused one while it exists, else the first", () => {
	expect(activeListRow(ROWS, "linear")).toBe("linear");
	expect(activeListRow(ROWS, "gone")).toBe("context7");
	expect(activeListRow(ROWS, null)).toBe("context7");
	expect(activeListRow([], null)).toBeNull();
});
