import type { SegmentedControlOption, SegmentedControlProps } from "@/panels/SegmentedControl";
import type { ComponentDoc, PropDoc } from "../types";
import { segmentComparisonTable } from "./toggle-segment";

type OwnProps = keyof SegmentedControlProps<string>;
type OptionFields = keyof SegmentedControlOption<string>;

export const segmentedControl = {
	slug: "segmented-control",
	name: "SegmentedControl",
	group: "Data entry",
	source: "apps/web/src/panels/SegmentedControl.tsx",
	preview: "basic",
	tag: "<SegmentedControl",
	importLine:
		'import { SegmentedControl, type SegmentedControlOption } from "@/panels/SegmentedControl";',
	summary:
		"A single-choice settings control: a row of options on one `control-bg` track, built from native radio inputs inside a named `radiogroup`. It owns the track, the selected segment, focus and disabled looks, and the radio keyboard model. The call site provides a unique `name`, an accessible `label`, the typed options, the current `value` (or `null` when the stored value matches no option) and an `onSelect` that writes the setting.",
	whenToUse: [
		"A setting with two to five short, mutually exclusive values that applies on selection: Theme mode, Contrast level, Message order, Composer size.",
		"A preset choice where the stored value may match no preset — pass `value={null}` and nothing is selected (Terminal scrollback).",
		"A choice where some values are unavailable on this host or theme, with per-option `disabled`.",
		"A choice that must lock while a write is in flight, with the group-level `disabled`.",
	],
	alternatives: [
		{
			name: "ToggleSegment",
			when: "Switching how a panel shows its content in a header or toolbar strip (List | Tree, Split | Inline).",
		},
		{
			name: "SettingsRadioCards",
			when: "Each option needs a description or hint, or the labels are too long for one row.",
		},
		{
			name: "SettingsSwitch",
			when: "The setting is a plain on/off.",
		},
		{
			name: "DropdownMenu",
			when: "There are more options than fit in one row, or the list comes from data.",
		},
	],
	anatomy: [
		{
			part: "Track",
			description:
				'A `role="radiogroup"` `<div>` named by `label`: an inline-flex row on `control-bg` with a small radius and clipped corners; it carries `testId`.',
		},
		{
			part: "Option",
			description:
				"A `<label>` per option with `data-active` and the option's `testId`; it wraps the input and the segment.",
		},
		{
			part: "Radio input",
			description:
				'A visually hidden native `<input type="radio">` with the group\'s `name`, the option `id` as its value, `checked` and `disabled`. It receives focus and keyboard input.',
		},
		{
			part: "Segment",
			description:
				"The visible text in `tr-text-ui`, full track height with horizontal padding. The selected one takes `control-bg-selected` with `text-default`.",
		},
		{
			part: "Focus ring",
			description:
				"An inset `ring-2` in `primary` on the segment while its radio has keyboard focus.",
		},
	],
	props: {
		name: {
			type: "string",
			description:
				"Required. The native radio group name. It must be unique on the page: two controls sharing a name become one radio group.",
		},
		label: {
			type: "string",
			description:
				"Required. The `aria-label` of the radiogroup. Use the row's label key (`settings.appearance.themeMode`); it is not shown.",
		},
		options: {
			type: "readonly SegmentedControlOption<T>[]",
			description: "The choices in display order. Fields are listed below.",
		},
		value: {
			type: "T | null",
			description:
				"Required. The selected option `id`. `null` selects nothing — for a host value that no option names.",
		},
		onSelect: {
			type: "(value: T) => void",
			description:
				"Called with the option `id` when a radio becomes checked — by click or by arrow keys. Not called for the option that is already selected.",
		},
		disabled: {
			type: "boolean",
			default: "false",
			description:
				"Disables every option, for example while a theme write is pending. Combined with each option's own `disabled`.",
		},
		testId: {
			type: "string",
			description: "Rendered as `data-testid` on the radiogroup.",
		},
	} satisfies Record<OwnProps, PropDoc>,
	nativeProps: {
		title: "Option fields (SegmentedControlOption<T>)",
		props: {
			id: {
				type: "T extends string",
				description:
					"The value passed to `onSelect` and compared with `value`; also the radio's `value`.",
			},
			label: {
				type: "string",
				description: "The visible text. Translate it at the call site (`t(option.label)`).",
			},
			testId: {
				type: "string",
				description: "Rendered as `data-testid` on the option's `<label>`.",
			},
			disabled: {
				type: "boolean",
				description:
					"Disables this option only, such as a theme mode the current family cannot reach.",
			},
		} satisfies Record<OptionFields, PropDoc>,
	},
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every row is the real component with real props. Hover an unselected option, click into the page and press Tab, then use the arrow keys.",
		},
		{
			id: "compare",
			title: "SegmentedControl and ToggleSegment",
			description:
				"The same choice in both components, sharing one state. SegmentedControl is for settings; ToggleSegment is for view toggles in chrome.",
			table: segmentComparisonTable,
		},
	],
	states: [
		{
			state: "Unselected",
			how: "An option whose `id` is not `value`.",
			appearance: "The track shows through; `text-muted` label.",
		},
		{
			state: "Hover",
			how: "Pointer over an unselected option.",
			appearance: "The label turns `text-default`; no fill. The selected option does not change.",
		},
		{
			state: "Pressed",
			how: "Pointer down.",
			appearance: "No distinct treatment.",
		},
		{
			state: "Selected",
			how: "`value` equals the option `id`.",
			appearance:
				"`control-bg-selected` segment with a small radius and a `text-default` label; the radio is checked.",
		},
		{
			state: "No selection",
			how: "`value={null}`.",
			appearance: "Every option looks unselected; no radio is checked.",
		},
		{
			state: "Keyboard focus",
			how: "Tab into the group, or move with the arrow keys.",
			appearance: "An inset `ring-2` in `primary` on the focused segment.",
		},
		{
			state: "Disabled",
			how: "Option `disabled`, or the group `disabled`.",
			appearance:
				"`control-disabled-text` label with no hover change and a default cursor. A selected option keeps its `control-bg-selected` fill.",
		},
	],
	accessibility: [
		'The track is `role="radiogroup"` with `aria-label={label}`; each option is a native radio whose accessible name is its wrapping `<label>` text.',
		"Selection is native `checked`, so assistive technology announces the option, its position in the group and whether it is selected.",
		"The inputs are visually hidden, not removed: focus lands on the radio and the segment shows the focus ring.",
		"Disabled options use the native `disabled` attribute; arrow keys skip them and they leave the Tab order.",
		"The group carries no description. Put the explanation in the surrounding SettingsRow `description`.",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action:
				"Moves focus into the group — to the checked option, or the first enabled one when `value` is `null` — and out of it; the whole group is one Tab stop.",
		},
		{
			keys: "Arrow Left / Arrow Up",
			action:
				"Moves to the previous enabled option, checks it and calls `onSelect`; wraps at the start.",
		},
		{
			keys: "Arrow Right / Arrow Down",
			action: "Moves to the next enabled option, checks it and calls `onSelect`; wraps at the end.",
		},
		{ keys: "Space", action: "Checks the focused option if it is not checked yet." },
	],
	rules: [
		{
			id: "SEG-1",
			text: "Use SegmentedControl for settings and form values with a few short options that apply on selection. A view toggle in a header strip is a ToggleSegment.",
		},
		{
			id: "SEG-2",
			text: "Give every control a unique `name` (`theme-mode`, `chat-message-order`) and an accessible `label` from the row's locale key.",
		},
		{
			id: "SEG-3",
			text: "Make `onSelect` cheap and idempotent: arrow keys select as they move, so each press writes the setting. Return early when the value is already current, as the settings pages do.",
		},
		{
			id: "SEG-4",
			text: "When the stored value matches no option, pass `value={null}` — never fall back to a nearby preset that would misreport the setting.",
		},
		{
			id: "SEG-5",
			text: "Keep unavailable options visible with per-option `disabled`; lock the whole control with `disabled` while a write is pending instead of hiding it.",
		},
		{
			id: "SEG-6",
			text: "Place it as the `control` of a SettingsRow, or under a stacked title and description; add no classes — the component takes none.",
		},
		{
			id: "SEG-7",
			text: "Keep labels short and options few: the track never wraps. Use SettingsRadioCards or a DropdownMenu when the choices do not fit one row.",
		},
	],
	examples: [
		{
			id: "basic",
			title: "Basic",
			description: "Two options with one selected; arrow keys move the selection.",
		},
		{
			id: "settings-row",
			title: "In a settings row",
			description: "Composer size as the control of a SettingsRow with a description.",
		},
		{
			id: "option-disabled",
			title: "Unavailable option",
			description:
				"Theme mode with System offered and Dark unavailable for the current theme family.",
		},
		{
			id: "pending",
			title: "Locked while saving",
			description: "The whole control is `disabled` while the simulated write is in flight.",
		},
		{
			id: "presets",
			title: "Presets",
			description: "Terminal scrollback: five presets under a stacked title and description.",
		},
		{
			id: "no-selection",
			title: "No matching option",
			description: "A stored value that names no preset selects nothing until the user picks one.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/AppearanceSettings.tsx",
			note: "Theme mode and Contrast level; per-option `disabled` and `disabled` while a theme write is pending.",
		},
		{
			file: "apps/web/src/panels/ChatSettings.tsx",
			note: "Message order and Composer size as SettingsRow controls.",
		},
		{
			file: "apps/web/src/panels/TerminalSettings.tsx",
			note: "Scrollback presets with `value={null}` for a non-preset host value.",
		},
	],
} satisfies ComponentDoc;
