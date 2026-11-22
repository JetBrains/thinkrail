import { expect, test } from "bun:test";
import type { LayoutPreset } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsList } from "../settingsKit";
import { deletablePreset, LayoutSettings, PresetRow } from "./LayoutSettings";
import { BUILTIN_LAYOUT_PRESETS } from "./layout";

const [balanced, focus] = BUILTIN_LAYOUT_PRESETS;
if (!balanced || !focus) throw new Error("built-in presets are missing");
const custom: LayoutPreset = { ...focus, id: "my-split", name: "My split" };

const markup = renderToStaticMarkup(<LayoutSettings />);
const tags = (pattern: RegExp, source = markup) => source.match(pattern) ?? [];

test("the presets are one list: each row is a walk row whose primary applies and is the list's tab stop", () => {
	const [list] = tags(/<ul[^>]*data-focus-list="layout-presets"[^>]*>/g);
	expect(list).toContain('data-key-scope="settings.list"');
	expect(list).toContain('data-setting-id="layout-presets"');
	const rows = tags(/<li[^>]*data-testid="layout-preset"[^>]*>/g);
	expect(rows.map((row) => /data-setting-row="([^"]+)"/.exec(row)?.[1])).toEqual(
		BUILTIN_LAYOUT_PRESETS.map((preset) => `layout-presets/${preset.id}`),
	);
	const primaries = tags(/<button[^>]*data-testid="layout-preset-apply"[^>]*>/g);
	expect(primaries).toHaveLength(BUILTIN_LAYOUT_PRESETS.length);
	expect(primaries.map((primary) => /tabindex="(-?\d)"/.exec(primary)?.[1])).toEqual([
		"0",
		"-1",
		"-1",
	]);
	expect(primaries.every((primary) => primary.includes("data-setting-primary"))).toBe(true);
	expect(rows.every((row) => /tabindex="(0|-1)"/.test(row))).toBe(true);
	expect(primaries.every((primary) => primary.includes('aria-disabled="true"'))).toBe(true);
	expect(markup).toContain("Open a workspace to apply a layout to its window.");
});

test("Set default is a button of every preset but the default, whose help is visible text", () => {
	const sides = tags(/<button(?![^>]*data-setting-primary)[^>]*>[^<]*Set default/g);
	expect(sides).toHaveLength(BUILTIN_LAYOUT_PRESETS.length - 1);
	expect(markup).toContain(
		"Reset to default rearranges this window into this layout. The default is remembered for this window only.",
	);
	expect(markup).not.toContain("About the default layout");
});

test("Add new layout shows its limit as text, never as a tooltip on a disabled button", () => {
	expect(markup).toContain("Up to 32 custom layouts; 0 used.");
	const [add] = tags(/<button[^>]*data-testid="layout-add-new"[^>]*>/g);
	expect(add).not.toContain("title=");
	expect(add).toMatch(/tabindex="0"/);
});

test("Advanced is a disclosure; the outline position is a cheap choice in Documents", () => {
	const [advanced] = tags(/<button[^>]*data-testid="layout-advanced-toggle"[^>]*>/g);
	expect(advanced).toContain('aria-expanded="false"');
	const [choice] = tags(/<div[^>]*data-testid="markdown-outline-side-control"[^>]*>/g);
	expect(choice).toContain('role="listbox"');
	expect(choice).toContain('data-cost="cheap"');
	expect(markup).toContain('data-setting-id="markdown-outline"');
});

test("a custom preset's row offers Rename and Delete… as buttons; built-ins can't be asked to delete", () => {
	const row = renderToStaticMarkup(
		<SettingsList focusList="layout-presets" label="Layout presets" rowIds={[custom.id]}>
			<PresetRow
				preset={custom}
				custom
				storedDefault={false}
				effectiveDefault={false}
				applied={false}
				canApply
				saving={false}
				renaming={null}
				onApply={() => {}}
				onRename={() => {}}
				onRenameCommit={() => {}}
				onDelete={() => {}}
			/>
		</SettingsList>,
	);
	const sides = tags(/<button(?![^>]*data-setting-primary)[^>]*>/g, row);
	expect(sides.map((side) => /aria-label="([^"]+)"/.exec(side)?.[1] ?? null)).toEqual([
		null,
		"Rename My split",
		"Delete My split",
	]);
	expect(row).toContain("Delete…");
	expect(row).toContain("Custom");
	expect(deletablePreset([custom], custom.id)).toBe(custom);
	expect(deletablePreset([custom], balanced.id)).toBeNull();
});
