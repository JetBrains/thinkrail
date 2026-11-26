import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { keybindingList, resolveKeybindings } from "../keybindings";
import { Tree } from "../panels/treeNavigation";
import { KeybindingAreaRow, KeybindingShortcutRow } from "./KeybindingTree";
import { keybindingAreas } from "./keybindingAreas";

const LINUX = "Linux x86_64";
const list = keybindingList({
	desktop: false,
	keybindings: resolveKeybindings({
		platform: LINUX,
		overrides: { "group.splitRight": ["Mod+Alt+KeyS"] },
	}),
	extensions: [],
});
const tabs = keybindingAreas(list, []).find((area) => area.id === "tabs");
const split = list.entries.find((entry) => entry.id === "group.splitRight");
const locked = list.entries.find((entry) => entry.id === "trees.firstLast");
if (!tabs || !split || !locked) throw new Error("fixture rows are missing");

const noop = () => {};
const markup = renderToStaticMarkup(
	<Tree label="Shortcuts" focusList="keybindings" className="flex flex-col" leaveAtEdges>
		<li role="none">
			<KeybindingAreaRow
				area={tabs}
				title="Tabs and groups"
				count="13 shortcuts"
				expanded
				enabled
				resettable
				onToggle={noop}
				onReset={noop}
			/>
			<ul role="none">
				<KeybindingShortcutRow
					entry={split}
					platform={LINUX}
					winner={(command) => command}
					changeable
					recording={false}
					dimmed={false}
					message={null}
					onRecord={noop}
					onReset={noop}
					onKeyDown={noop}
					onBlur={noop}
				/>
				<KeybindingShortcutRow
					entry={locked}
					platform={LINUX}
					winner={(command) => command}
					changeable={false}
					recording={false}
					dimmed={false}
					message={null}
					onRecord={noop}
					onReset={noop}
					onKeyDown={noop}
					onBlur={noop}
				/>
			</ul>
		</li>
	</Tree>,
);

const tag = (testId: string) =>
	markup.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`, "g")) ?? [];

test("the area is a level-1 tree item that toggles and shows its counts and changed marker", () => {
	const [group] = tag("keybinding-group");
	expect(group).toContain('role="treeitem"');
	expect(group).toContain('aria-level="1"');
	expect(group).toContain('aria-expanded="true"');
	expect(group).toContain('data-tree-toggle="area:tabs"');
	expect(group).toMatch(/tabindex="(0|-1)"/);
	expect(markup).toContain("13 shortcuts");
	expect(tag("keybinding-group-changed")).toHaveLength(1);
	expect(markup).toContain("1 changed");
});

test("a shortcut is a level-2 tree item and its own jump target", () => {
	const [row] = tag("keybinding-row");
	expect(row).toContain('role="treeitem"');
	expect(row).toContain('aria-level="2"');
	expect(row).toContain('data-setting-id="shortcut:group.splitRight"');
	expect(row).toContain('data-command="group.splitRight"');
	expect(row).toContain('data-custom="true"');
	expect(row).toContain("data-focus-row-primary");
	expect(markup).toContain("Default: Ctrl+\\");
});

test("every button in a tree item is a real tab stop that hint mode can press: an explicit tabindex, never aria-hidden", () => {
	const sides = markup.match(/<button[^>]*>/g) ?? [];
	expect(sides.length).toBe(3);
	for (const side of sides) {
		expect(side).toMatch(/tabindex="(0|-1)"/);
		expect(side).not.toContain("aria-hidden");
	}
	expect(tag("keybinding-group-reset")[0]).toContain("data-setting-reset");
	expect(tag("keybinding-reset")[0]).toContain("data-setting-reset");
	expect(tag("keybinding-change")[0]).toContain('aria-label="Change Split right"');
});

test("a locked shortcut has no sides and reads as disabled", () => {
	const row = tag("keybinding-row").find((each) => each.includes('data-command="trees.firstLast"'));
	expect(row).toContain('aria-disabled="true"');
	expect(row).toContain('data-locked="true"');
	expect(markup.match(/data-testid="keybinding-change"/g)).toHaveLength(1);
});

test("a recording row frames its chord slot with the editing frame, so it reads apart from a focused row", () => {
	const recording = renderToStaticMarkup(
		<Tree label="Shortcuts" focusList="keybindings" className="flex flex-col" leaveAtEdges>
			<KeybindingShortcutRow
				entry={split}
				platform={LINUX}
				winner={(command) => command}
				changeable
				recording
				dimmed={false}
				message={null}
				onRecord={noop}
				onReset={noop}
				onKeyDown={noop}
				onBlur={noop}
			/>
		</Tree>,
	);
	const slot = (html: string) =>
		html.match(/<span[^>]*data-testid="keybinding-chord"[^>]*>/)?.[0] ?? "";
	expect(slot(recording)).toContain("focus-ring-editing");
	expect(recording).toContain("Press a new shortcut");
	expect(slot(markup)).not.toContain("focus-ring-editing");
});
