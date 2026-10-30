import type { SettingsRadioCards, SettingsRadioChoice } from "@/panels/SettingsRadioCards";
import type { ComponentDoc, PropDoc } from "../types";

type SettingsRadioCardsProps = Parameters<typeof SettingsRadioCards>[0];

export const settingsRadioCards = {
	slug: "settings-radio-cards",
	name: "SettingsRadioCards",
	group: "Data entry",
	source: "apps/web/src/panels/SettingsRadioCards.tsx",
	preview: "preview",
	tag: "<SettingsRadioCards",
	importLine:
		'import { SettingsRadioCards, type SettingsRadioChoice } from "@/panels/SettingsRadioCards";',
	summary:
		"A settings radio group drawn as a stack of cards. Each card has a label, an optional short hint and a one-line description, and the selected card shows a check. It renders native radio inputs sharing one `name`, so the browser handles keyboard, focus and checked state. The call site supplies the translated choices, the current `value` from the store and `onSelect`, which writes the setting.",
	whenToUse: [
		"A setting with one value out of a few exclusive options, where each option needs a sentence explaining what it does — the Windows shell, how long before idle workspaces settle.",
		"A list whose options can be unavailable and must still show why — language files that are missing or cannot be read.",
		"An option that needs a short qualifier next to its name: *Recommended*, *default*, a source such as *Built-in* or *Local file*.",
	],
	alternatives: [
		{
			name: "SegmentedControl",
			when: "The options are a few short presets that need no description, such as Terminal scrollback or Theme mode.",
		},
		{
			name: "SettingsSwitch",
			when: "The setting is on or off.",
		},
		{
			name: "DropdownMenu",
			when: "The choice sits in a compact row or toolbar, or there are too many options to stack as cards.",
		},
		{
			name: "SettingsRow and SettingsGroup",
			when: "Surrounding layout: put the cards inside a SettingsGroup, or use a row when the control is a single button or switch.",
		},
	],
	anatomy: [
		{
			part: "Group",
			description:
				'A `<div role="radiogroup">` named by `label`; the cards stack in a column with `gap-4`.',
		},
		{
			part: "Card",
			description:
				"A `<label>` for each choice, carrying `data-testid` (the choice's `testId`) and `data-active`. It has a `rounded-sm` border and `px-12 py-8` padding, and the whole card is the click target.",
		},
		{
			part: "Radio",
			description:
				'A visually hidden (`sr-only`) native `<input type="radio">` with the group\'s `name` and the choice `id` as its value. It holds the checked and disabled state.',
		},
		{
			part: "Title line",
			description:
				"The choice `label` in `tr-title-compact text-text-default`, then the optional `hint` in `tr-text-metadata text-text-muted`.",
		},
		{
			part: "Description",
			description:
				"The choice `description` in `tr-text-metadata text-text-muted`, on its own line.",
		},
		{
			part: "Check",
			description:
				"A `size-16` `RiCheckLine` in `text-primary` at the end of the selected card only.",
		},
	],
	props: {
		name: {
			type: "string",
			description:
				"The native radio group name. It must be unique on the page: two groups with the same name become one group.",
		},
		label: {
			type: "string",
			description:
				"The group's accessible name (`aria-label`). Production passes the same string as the visible heading above it.",
		},
		choices: {
			type: "readonly SettingsRadioChoice<T>[]",
			description: "The cards, in order. Texts are already translated; see *Choice fields*.",
		},
		value: {
			type: "T",
			description:
				"The selected choice `id`, read from the store. A value that matches no choice selects none.",
		},
		disabled: {
			type: "boolean",
			default: "false",
			description:
				"Disables every radio in the group, for example while the host cannot apply the setting.",
		},
		onSelect: {
			type: "(value: T) => void",
			description:
				"Called with the newly selected `id` from the native `change` event. It does not fire for the card that is already selected.",
		},
	} satisfies Record<keyof SettingsRadioCardsProps, PropDoc>,
	nativeProps: {
		title: "Choice fields (SettingsRadioChoice)",
		props: {
			id: {
				type: "T",
				description:
					"The value written to `onSelect` and compared with `value`; also the radio's `value`.",
			},
			label: {
				type: "string",
				description: 'The card\'s name, translated: `t("…")` or an own-language name.',
			},
			hint: {
				type: "string",
				description:
					"Optional short qualifier after the label: *Recommended*, *default*, *File not found*.",
			},
			description: {
				type: "string",
				description: "Required. One line on what the choice does or why it is unavailable.",
			},
			testId: {
				type: "string",
				description: "Set as the card's `data-testid`.",
			},
			disabled: {
				type: "boolean",
				description: "Makes this one choice unselectable while it stays in the list.",
			},
		} satisfies Record<keyof SettingsRadioChoice<string>, PropDoc>,
	},
	states: [
		{
			state: "Rest",
			how: "A choice that is not `value`.",
			appearance: "A `border-default` border with no fill; pointer cursor.",
		},
		{
			state: "Hover",
			how: "Pointer over a card that is not selected.",
			appearance:
				"`control-bg-hovered` fill. Disabled cards that are not selected still take it. Selected cards do not change.",
		},
		{
			state: "Keyboard focus",
			how: "Tab into the group or move with the arrow keys.",
			appearance:
				"A `ring-2` `primary` ring around the focused card (`has-[:focus-visible]`), drawn from the hidden radio's focus.",
		},
		{
			state: "Selected",
			how: "`value` equals the choice `id`.",
			appearance:
				'`primary-muted` border on a `primary-subtle` fill, a `primary` check at the end, and `data-active="true"`.',
		},
		{
			state: "No selection",
			how: "`value` matches no choice (a host value outside the presets).",
			appearance: "Every card at rest and no check.",
		},
		{
			state: "Disabled choice",
			how: "`disabled` on a choice.",
			appearance:
				"The radio is natively disabled and the cursor is the default one. No other distinct treatment: colours, hint and description stay as they are.",
		},
		{
			state: "Selected and disabled",
			how: "`value` is a disabled choice (a language file that was selected and then removed).",
			appearance: "The selected look with the check. The choice cannot be selected again.",
		},
		{
			state: "Disabled group",
			how: "`disabled` on the component.",
			appearance:
				"Every radio disabled, with the same look as a disabled choice; the selected card keeps its look.",
		},
	],
	accessibility: [
		'The wrapper is a `role="radiogroup"` named by `label`. Each card is a native radio inside its `<label>`, so role, checked and disabled state come from the platform.',
		"A radio's accessible name is the whole card text — label, hint and description — because the `<label>` wraps all three.",
		"Radios that share `name` form one tab stop with arrow-key movement. Give every group its own `name`.",
		"The focus ring is on the card. The input itself is `sr-only`, so nothing else shows focus.",
		"Disabled choices are skipped by the arrow keys and cannot be clicked. The reason must be in their hint or description, because nothing else explains it.",
		"The check icon repeats the checked state visually; the state itself is the radio's `checked`.",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action:
				"Moves focus into the group, onto the selected card (or an end card when none is selected), and out again. The group is one tab stop.",
		},
		{
			keys: "Arrow Down / Arrow Right",
			action: "Selects the next enabled card, wrapping at the end; calls `onSelect`.",
		},
		{
			keys: "Arrow Up / Arrow Left",
			action: "Selects the previous enabled card, wrapping at the start; calls `onSelect`.",
		},
		{ keys: "Space", action: "Selects the focused card when nothing is selected yet." },
	],
	rules: [
		{
			id: "SRC-1",
			text: "Use SettingsRadioCards in Settings when each exclusive option needs a description. Short presets without one are a SegmentedControl, and an on/off setting is a SettingsSwitch.",
		},
		{
			id: "SRC-2",
			text: "Every choice has a `description` saying what it does. `hint` is only for a short qualifier (*Recommended*, *default*, a source, *File not found*). Keep the choice specs typed as `MessageKey`s and translate them when rendering; own-language names and language tags stay untranslated.",
		},
		{
			id: "SRC-3",
			text: "Keep it controlled by host state. `onSelect` returns early for the current value, sends `settings.update` and shows a toast on failure. `value` changes only when `settings.changed` arrives — never update it optimistically.",
		},
		{
			id: "SRC-4",
			text: "A host value outside the presets selects no card. Never map it to the nearest card or the default.",
		},
		{
			id: "SRC-5",
			text: "Keep unavailable options in the list as disabled choices, with the reason in `hint` and `description`. Disable the whole group while the host cannot apply the setting; hide it when the setting does not apply at all, as the Windows shell picker does on other platforms.",
		},
		{
			id: "SRC-6",
			text: "Give each group a unique `name` and a `label` that repeats the setting's heading. Put the heading and the section description outside the group.",
		},
		{
			id: "SRC-7",
			text: "The component accepts no `className`. Place it with a wrapper (`py-12` inside a SettingsGroup) and do not restyle cards; the selected, hover and focus looks belong to the component.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Basic",
			description: "Three shells, one selected, with a *Recommended* hint.",
		},
		{
			id: "windows-shell",
			title: "Heading and description",
			description:
				"The Windows shell picker: `MessageKey` specs translated when rendering, with a heading and a description above the group.",
		},
		{
			id: "settle-idle",
			title: "Plural labels and a default",
			description:
				"Settle idle workspaces after: plural day labels, a *default* hint and a *Never* choice.",
		},
		{
			id: "non-preset",
			title: "Value outside the presets",
			description: "A host-configured five days selects no card until the user picks one.",
		},
		{
			id: "unavailable",
			title: "Unavailable choices",
			description:
				"A selected language file that went missing and a file that cannot be used stay listed as disabled, with the reason as their hint and description.",
		},
		{
			id: "group-disabled",
			title: "Disabled group",
			description: "`disabled` while the connected host cannot apply the setting.",
		},
		{
			id: "settings-group",
			title: "Inside a SettingsGroup",
			description: "The Language page layout: the group's title and description, then the cards.",
		},
		{
			id: "host-confirmed",
			title: "Waits for the host",
			description:
				"`onSelect` sends the update; the selection moves only when the mocked `settings.changed` arrives.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/TerminalSettings.tsx",
			note: "The Windows shell picker (Windows hosts only), with a *Recommended* hint on Auto.",
		},
		{
			file: "apps/web/src/panels/WorkspacesSettings.tsx",
			note: "Settle idle workspaces after: plural labels, a *default* hint, no selection for a non-preset value, disabled on older hosts.",
		},
		{
			file: "apps/web/src/panels/LanguageSettings.tsx",
			note: "The interface language: System first, source hints, missing and broken files as disabled choices.",
		},
	],
} satisfies ComponentDoc;
