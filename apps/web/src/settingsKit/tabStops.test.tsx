import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { SettingsGroup } from "./SettingsGroup";
import { parseSettingsNumber, SettingsNumberField } from "./SettingsNumberField";
import { SettingsPage } from "./SettingsPage";
import { SettingsRow } from "./SettingsRow";
import { SettingsSlider, sliderStep } from "./SettingsSlider";

const markup = renderToStaticMarkup(
	<SettingsPage title="Text & fonts" description="Fonts, sizes and line widths.">
		<SettingsGroup title="Line width" scope="device">
			<SettingsRow
				settingId="chat-line-width"
				label="Chat line width"
				control={
					<SettingsNumberField
						label="Chat line width"
						value={80}
						min={40}
						max={240}
						onCommit={() => undefined}
					/>
				}
				reset={{ changed: true, onReset: () => {} }}
			/>
			<SettingsRow
				settingId="font-weight"
				label="Text weight"
				control={
					<SettingsSlider
						label="Text weight"
						value={0}
						min={-2}
						max={2}
						marker={0}
						onChange={() => {}}
						onCommit={() => {}}
					/>
				}
			/>
			<SettingsDisclosure rowId="advanced" label="Advanced" defaultExpanded>
				<SettingsRow settingId="left-groups" label="Left groups" />
			</SettingsDisclosure>
		</SettingsGroup>
	</SettingsPage>,
);

test("every button and input the blocks render has an explicit tabindex (WebKit Tab skips the rest)", () => {
	const stops = markup.match(/<(button|input)\b[^>]*>/g) ?? [];
	expect(stops.length).toBe(4);
	expect(stops.filter((stop) => !/tabindex="(0|-1)"/.test(stop))).toEqual([]);
});

test("the page and group render the heading, description and a visible scope tag", () => {
	expect(markup).toMatch(/<h2[^>]*>Text &amp; fonts<\/h2>/);
	expect(markup).toContain("Fonts, sizes and line widths.");
	expect(markup).toContain('data-scope="device"');
	expect(markup).toContain("This computer");
});

test("a number field is text with a numeric keyboard, clean until edited", () => {
	const input = markup.match(/<input[^>]*type="text"[^>]*>/)?.[0] ?? "";
	expect(input).toContain('inputMode="numeric"');
	expect(input).toContain("data-setting-clean");
	expect(input).toContain('value="80"');
	expect(parseSettingsNumber("120", 40, 240)).toBe(120);
	expect(parseSettingsNumber("12a", 40, 240)).toBeNull();
	expect(parseSettingsNumber("300", 40, 240)).toBeNull();
});

test("a disclosure toggle is a walk row and its own stop", () => {
	const toggle = markup.match(/<button[^>]*aria-expanded[^>]*>/)?.[0] ?? "";
	expect(toggle).toContain('data-setting-row="advanced"');
	expect(toggle).toContain("data-setting-stop");
	expect(toggle).toContain('aria-expanded="true"');
	expect(markup).toContain('data-setting-row="left-groups"');
});

test("a slider steps within its range and reports the edges", () => {
	expect(sliderStep(0, -2, 2, 1, 1)).toBe(1);
	expect(sliderStep(2, -2, 2, 1, 1)).toBeNull();
	expect(sliderStep(-2, -2, 2, 1, -1)).toBeNull();
});

test("a group's header action is its own walk row, and a long title may wrap", () => {
	const group = renderToStaticMarkup(
		<SettingsGroup
			title="Project templates"
			scope="project"
			action={{
				rowId: "templates-project-new",
				control: (
					<button type="button" tabIndex={0}>
						New
					</button>
				),
			}}
		>
			<SettingsRow settingId="project-templates" label="Templates" />
		</SettingsGroup>,
	);
	expect(group).toMatch(/<h3[^>]*break-words[^>]*>Project templates<\/h3>/);
	expect(group).toMatch(
		/data-setting-row="templates-project-new"[^>]*><button[^>]*tabindex="0"[^>]*>New<\/button>/,
	);
	expect(group.indexOf("templates-project-new")).toBeLessThan(group.indexOf("project-templates"));
});
