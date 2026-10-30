import type { SettingsGroupProps, SettingsPageContainerProps } from "@/panels/SettingsGroup";
import type { SettingsRowProps } from "@/panels/SettingsRow";
import type { ComponentDoc, PropDoc } from "../types";

type Part<Name extends string, P> = `${Name}.${Extract<keyof P, string>}`;
type OwnProps =
	| keyof SettingsRowProps
	| Part<"SettingsGroup", SettingsGroupProps>
	| Part<"SettingsPageContainer", SettingsPageContainerProps>;

export const settingsRow = {
	slug: "settings-row",
	name: "SettingsRow and SettingsGroup",
	group: "Data entry",
	source: "apps/web/src/panels/SettingsRow.tsx",
	preview: "preview",
	tag: "<SettingsRow",
	importLine:
		'import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "@/panels/SettingsRow";\nimport { SettingsGroup, SettingsPageContainer } from "@/panels/SettingsGroup";',
	summary:
		"The layout kit every Settings section is built from: `SettingsPageContainer` stacks a section's groups, `SettingsGroup` is one titled block of rows, and `SettingsRow` is one setting — a label, an optional description and one control on the right. The kit owns spacing, dividers, label typography and the narrow-width wrap; the call site provides the words and the control (SettingsSwitch, SegmentedControl, Button…), and the control owns its own name, state and saving.",
	whenToUse: [
		"Every page of the Settings dialog: wrap the page in `SettingsPageContainer` and give each topic its own `SettingsGroup`.",
		"One setting with one control — a switch, a segmented choice, a picker, a Button that starts an action — as a `SettingsRow`.",
		"A section with a single, untitled list of rows (Notifications, Terminal, Privacy): put the rows in a `<div className={SETTINGS_ROWS_CONTAINER}>` instead of a group.",
		"A row whose control is a small cluster (two Buttons, a source tag beside a switch): wrap the cluster in one flex element and pass it as `control`.",
	],
	alternatives: [
		{
			name: "SettingsRadioCards",
			when: "Each option needs its own description, or the choice is too wide for a row's right column (language, Windows shell, idle settling). Put it in the group below its heading, not in `control`.",
		},
		{
			name: "SettingsNotice",
			when: "A message about the setting (a permission prompt, a fallback, a restart hint). Place it as a sibling block under the row, never as the row's `control`.",
		},
		{
			name: "TreeRow",
			when: "A navigable, selectable list item in a tree or sidebar rather than a setting.",
		},
		{
			name: "Collapsible",
			when: "Advanced settings hidden by default; the rows inside still use this kit.",
		},
	],
	anatomy: [
		{
			part: "SettingsPageContainer",
			description:
				"A column that wraps each child in its own block. A block that renders nothing is hidden (`empty:hidden`); a block after a rendered one gets top spacing and a `border-border-muted` rule, so rules appear only between groups that render.",
		},
		{
			part: "SettingsGroup",
			description:
				"A `<section>` with a header — the `<h3>` title in `tr-text-label-pill` / `text-text-subtle` and an optional description in `tr-text-metadata` / `text-text-muted` — over a `SETTINGS_ROWS_CONTAINER` that holds the children.",
		},
		{
			part: "SETTINGS_ROWS_CONTAINER",
			description:
				"An exported class string: a flex column whose last child loses its bottom border, so a list of rows ends without a trailing divider. Used by `SettingsGroup` and directly by untitled sections.",
		},
		{
			part: "SettingsRow",
			description:
				"A wrapping flex row with vertical padding and a `border-border-muted` bottom divider (unless `noBorder`).",
		},
		{
			part: "Label column",
			description:
				"Grows to fill the row with a minimum width (`min-w-160`): the `label` in `tr-text-ui` / `text-text-default` and, under it, the `description` in `tr-text-metadata` / `text-text-muted`.",
		},
		{
			part: "Control slot",
			description:
				"Holds `control` at its natural width on the right, never wider than the row. When it no longer fits beside the label column it wraps below the label.",
		},
	],
	props: {
		label: {
			type: "string",
			description:
				"The setting's visible name, from a locale key. Plain text only; it is not linked to the control, so the control needs its own accessible label (usually the same string).",
		},
		description: {
			type: "ReactNode",
			description:
				"One short line under the label: what the setting does, or the current consequence of its value. May be a node — a `<code>` path, for example.",
		},
		control: {
			type: "ReactNode",
			description:
				"The one control for this setting: SettingsSwitch, SegmentedControl, a Button, a picker, or one flex element wrapping a small cluster.",
		},
		testId: { type: "string", description: "`data-testid` on the row." },
		noBorder: {
			type: "boolean",
			default: "false",
			description:
				"Drops the row's bottom divider. Rarely needed: inside `SETTINGS_ROWS_CONTAINER` or `SettingsGroup` the last row already loses it.",
		},
		className: {
			type: "string",
			description: "Placement only, such as top margin after a non-row block (`mt-24`).",
		},
		"SettingsGroup.title": {
			type: "string",
			description: "The group heading (`<h3>`), from a locale key.",
		},
		"SettingsGroup.description": {
			type: "string | undefined",
			description: "One explanatory line under the title. Plain text.",
		},
		"SettingsGroup.children": {
			type: "ReactNode",
			description:
				"The group's rows, plus any blocks that belong between them (a notice, a radio-card list, a sub-heading).",
		},
		"SettingsGroup.testId": { type: "string", description: "`data-testid` on the `<section>`." },
		"SettingsPageContainer.children": {
			type: "ReactNode",
			description:
				"The page's groups, in order. Give conditional children a `key` so the others never remount when one appears; `null`/`false` children and components that render `null` leave no rule behind.",
		},
		"SettingsPageContainer.testId": {
			type: "string",
			description: "`data-testid` on the page column, e.g. `settings-chat`.",
		},
	} satisfies Record<OwnProps, PropDoc>,
	states: [
		{
			state: "Default",
			how: "A row with `label` and `control`.",
			appearance:
				"Label left, control right, vertically centred; a muted bottom divider under the row.",
		},
		{
			state: "With description",
			how: "`description`.",
			appearance: "A muted metadata line under the label; the control stays centred on both lines.",
		},
		{
			state: "Last row",
			how: "The row is the last child of `SETTINGS_ROWS_CONTAINER` or a `SettingsGroup`.",
			appearance: "No bottom divider.",
		},
		{
			state: "No border",
			how: "`noBorder`.",
			appearance: "No bottom divider wherever the row sits.",
		},
		{
			state: "Narrow",
			how: "The column is too narrow for the label column's minimum width plus the control.",
			appearance: "The control wraps onto its own line below the label, aligned left.",
		},
		{
			state: "Hover, focus, disabled",
			how: "—",
			appearance:
				"No distinct treatment: the row is not interactive. Hover, focus ring and disabled belong to the control (e.g. a SegmentedControl `disabled` while a save is pending).",
		},
		{
			state: "Empty page child",
			how: "A `SettingsPageContainer` child is `null` or a component that renders nothing.",
			appearance: "Its block is hidden and draws no rule or spacing.",
		},
	],
	accessibility: [
		"`SettingsRow` renders plain `<div>`/`<span>` elements: the visible `label` is **not** associated with the control. Give every control its own name — `label` on SettingsSwitch and SegmentedControl, the Button's text or `aria-label` — normally the same locale string as the row label.",
		"When a row's control is scoped (a workspace override), name it fully in the control's label (`Allow subagents in {{name}}`) even if the row label is short.",
		"`SettingsGroup` renders a `<section>` whose title is an `<h3>`, so screen-reader users can jump between groups by heading. The section is not labelled by that heading.",
		"The description is plain text next to the label and is not wired to the control with `aria-describedby`; keep anything the user must know to operate the control in the control's own label or tooltip.",
		"Reading and Tab order follow the DOM: label, description, then the control. Wrapping at narrow widths does not reorder anything.",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action:
				"Moves between the rows' controls in document order; the rows themselves take no focus.",
		},
		{
			keys: "Space / Enter / arrows",
			action:
				"Handled by the control: Space or Enter toggles a SettingsSwitch, arrow keys move within a SegmentedControl.",
		},
	],
	rules: [
		{
			id: "SRW-1",
			text: "Build every Settings page from the kit: `SettingsPageContainer` → `SettingsGroup` → `SettingsRow`. Do not hand-roll the row shape (`flex justify-between border-b py-12`) or group headers.",
		},
		{
			id: "SRW-2",
			text: "One row, one setting, one control. A small related cluster (Copy path + Open folder, a source tag + its switch) goes in one flex wrapper; a choice with per-option descriptions is SettingsRadioCards below the heading, not a row.",
		},
		{
			id: "SRW-3",
			text: "Always name the control itself — SettingsSwitch and SegmentedControl `label`, Button text — because the row label is not linked to it.",
		},
		{
			id: "SRW-4",
			text: "The row owns layout and typography: pass words through `label` and `description`, never style them, and use `className` for placement only.",
		},
		{
			id: "SRW-5",
			text: "Rows apply immediately; a Settings page has no Save or Apply button. While a save is in flight, disable the control rather than the row, and let the value follow the host's broadcast.",
		},
		{
			id: "SRW-6",
			text: "Let the containers draw dividers: put rows inside `SettingsGroup` or `SETTINGS_ROWS_CONTAINER` so the last one ends clean, and render optional groups as keyed conditional children of `SettingsPageContainer` instead of adding your own rules or margins.",
		},
		{
			id: "SRW-7",
			text: "A notice, sub-heading or other block between rows is a sibling of the rows, not their `control`; give it its own vertical padding so it sits on the row rhythm.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Group of rows",
			description: "A titled group with a SegmentedControl row and a SettingsSwitch row.",
		},
		{
			id: "page",
			title: "Settings page",
			description:
				"`SettingsPageContainer` with two groups, as Chat settings composes them; the switch row's description follows its value.",
		},
		{
			id: "conditional-groups",
			title: "Conditional groups",
			description:
				"Sign in or out to move providers between groups; a group appears only while it has rows, and the rule between groups follows.",
		},
		{
			id: "pending",
			title: "Pending save",
			description:
				"Choosing a value disables the controls until the save lands, as Appearance does; the rows do not change.",
		},
		{
			id: "button-control",
			title: "Action row",
			description:
				"A Button as the control, opening a confirmation, with the consequence in the description.",
		},
		{
			id: "folder-row",
			title: "Rich description and a control cluster",
			description: "A `<code>` path as the description and two Buttons in one wrapper.",
		},
		{
			id: "override-tag",
			title: "Workspace override",
			description:
				"A source tag beside the switch: toggle to make it Custom, click Custom to return to the global value.",
		},
		{
			id: "rows-container",
			title: "Untitled rows",
			description:
				"`SETTINGS_ROWS_CONTAINER` without a group, with a notice block under the row while the setting is on.",
		},
		{
			id: "narrow",
			title: "Narrow column",
			description: "When the control does not fit beside the label, it wraps below it.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/ChatSettings.tsx",
			note: "`SettingsPageContainer` with the Appearance and behavior group of SegmentedControl rows, followed by the Subagents group.",
		},
		{
			file: "apps/web/src/panels/SubagentSettings.tsx",
			note: "A `SettingsGroup` with a description; switch rows, number fields and a source tag beside the switch.",
		},
		{
			file: "apps/web/src/panels/AppearanceSettings.tsx",
			note: "Theme mode and contrast SegmentedControl rows disabled while pending, a conditional read-only row and `SETTINGS_ROWS_CONTAINER` inside a disclosure.",
		},
		{
			file: "apps/web/src/panels/LanguageSettings.tsx",
			note: "Folder row with a `<code>` description and Copy path / Open folder Buttons, plus a link row.",
		},
		{
			file: "apps/web/src/panels/NotificationsSettings.tsx",
			note: "Untitled `SETTINGS_ROWS_CONTAINER` section: a switch row with notice blocks under it.",
		},
		{
			file: "apps/web/src/shell/LayoutSettings.tsx",
			note: "Reset to default row with an outline Button, and a nested `SettingsGroup` of limit inputs.",
		},
	],
} satisfies ComponentDoc;
