import type { SwitchProps } from "@thinkrail/ui/switch";
import type { ButtonHTMLAttributes } from "react";
import type { ComponentDoc, PropDoc } from "../types";

type OwnProps = Exclude<keyof SwitchProps, keyof ButtonHTMLAttributes<HTMLButtonElement>>;

export const switchComparisonDescription =
	'Both render a `role="switch"` button with the same track and knob geometry, but they are two implementations (audit F-04). Every cell is the real component: hover and Tab into each column to compare.';

export const switchComparisonTable = {
	head: ["Aspect", "Switch", "SettingsSwitch"],
	rows: [
		[
			"Hit area and hover",
			"The track sits in a larger round hit area that takes `control-bg-hovered` on hover.",
			"The button is the track itself; no hover treatment.",
		],
		[
			"Knob when on",
			"`control-primary-text`, the label colour on the primary fill.",
			"Stays `container-workspace-bg` in both states.",
		],
		[
			"Disabled",
			"Disabled colour roles: track `control-primary-disabled-bg` (on) or `control-disabled-border` (off), knob `control-disabled-text`.",
			"The enabled colours at `opacity-50`.",
		],
		[
			"Focus ring",
			"Drawn around the hit area, clear of the track.",
			"Drawn flush against the track; on the `primary` track it merges with the fill.",
		],
		[
			"Reduced motion",
			"Track and knob transitions stop under `prefers-reduced-motion`.",
			"Transitions always run.",
		],
		[
			"API",
			"`onCheckedChange`; optional `testId`; native button props, `className` and `ref` pass through; `onClick` can cancel with `preventDefault()`.",
			"`onChange`; required `testId`; nothing else is accepted.",
		],
	],
} as const;

export const switchDoc = {
	slug: "switch",
	name: "Switch",
	group: "Data entry",
	source: "packages/ui/switch.tsx",
	preview: "basic",
	tag: "<Switch",
	importLine: 'import { Switch } from "@thinkrail/ui/switch";',
	summary:
		'The shared on/off control: a native `<button role="switch">` that reports the next state through `onCheckedChange`. It owns the track, the knob, the hover hit area, focus, disabled colours and motion. The call site provides the controlled `checked` value, an accessible `label` and the visible text beside it.',
	whenToUse: [
		"A setting or option that takes effect as soon as it is flipped: enable an extension or MCP server, load a skill.",
		"A yes/no option inside a dialog form that the submit reads: delete the branch after merging, draft specs with the agent.",
		"A per-item enable control at the end of a list row, next to the row's other actions.",
		"A switch whose state needs a spoken or hovered explanation, wrapped in IconTooltip with `aria-description`.",
	],
	alternatives: [
		{
			name: "SettingsSwitch",
			when: "The existing Settings-dialog switch in `apps/web/src/panels`. It looks and behaves differently (no hover area, opacity-dimmed disabled state, no `className`); see *Switch and SettingsSwitch* below. New code uses Switch.",
		},
		{
			name: "Button",
			when: "An action, or a text toggle that changes a view rather than a setting (`selected` with `aria-pressed`).",
		},
		{
			name: "ToggleSegment",
			when: "Choosing one of a few views in a header strip.",
		},
		{
			name: "SegmentedControl",
			when: "A setting with more than two named values, or two values that are not on/off.",
		},
	],
	anatomy: [
		{
			part: "Hit area",
			description:
				'The `<button type="button" role="switch">`: a round area slightly larger than the track that takes the hover fill and the focus ring.',
		},
		{
			part: "Track",
			description:
				"An `aria-hidden` rounded span: `border-default` when off, `primary` when on, disabled roles while disabled.",
		},
		{
			part: "Knob",
			description:
				"A round span inside the track that slides to the end when on; `container-workspace-bg` off, `control-primary-text` on.",
		},
		{
			part: "Visible text",
			description:
				"Not part of the component. The call site places the setting's name (and detail) beside it; the switch shows no On/Off text.",
		},
	],
	props: {
		checked: {
			type: "boolean",
			description:
				"Required. The current state; the switch is fully controlled and keeps no state of its own.",
		},
		label: {
			type: "string",
			description:
				"Required. The accessible name (`aria-label`). Use a locale key that names the setting, and the item in a list (`Enable {{title}}`).",
		},
		onCheckedChange: {
			type: "(checked: boolean) => void",
			description:
				"Required. Called once per activation with the next state (`!checked`). Not called while disabled or when `onClick` called `preventDefault()`.",
		},
		testId: {
			type: "string",
			description: "Rendered as `data-testid`.",
		},
		ref: {
			type: "Ref<HTMLButtonElement>",
			description:
				"Forwarded to the `<button>` (React 19 ref prop), so the switch can be a Radix `asChild` trigger.",
		},
	} satisfies Record<OwnProps, PropDoc>,
	nativeProps: {
		title: "Native button props",
		props: {
			disabled: {
				type: "boolean",
				default: "false",
				description:
					"Native disabled: no focus, no activation, no pointer events (so no hover and no tooltip without a wrapper), disabled colour roles.",
			},
			onClick: {
				type: "MouseEventHandler",
				description:
					"Runs before the change; call `event.preventDefault()` to cancel it. `onCheckedChange` is the normal handler.",
			},
			className: {
				type: "string",
				description: "Placement only: margins, flex/grid placement, alignment.",
			},
			"aria-description": {
				type: "string",
				description:
					"Extra spoken detail, for example the tooltip text that explains the current state or why it is blocked.",
			},
		} satisfies Partial<Record<keyof SwitchProps, PropDoc>>,
	},
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. Hover and click the first row, or click into the page and press Tab to see keyboard focus. Disabled is the real prop.",
		},
		{
			id: "compare",
			title: "Switch and SettingsSwitch",
			description: switchComparisonDescription,
			table: switchComparisonTable,
		},
	],
	states: [
		{
			state: "Off",
			how: "`checked={false}`.",
			appearance: "`border-default` track, `container-workspace-bg` knob at the start.",
		},
		{
			state: "On",
			how: "`checked`.",
			appearance: "`primary` track, `control-primary-text` knob at the end.",
		},
		{
			state: "Hover",
			how: "Pointer over the switch.",
			appearance:
				"The hit area behind the track takes `control-bg-hovered`; the track and knob do not change.",
		},
		{ state: "Pressed", how: "Pointer down or Space held.", appearance: "No distinct treatment." },
		{
			state: "Keyboard focus",
			how: "Tab to the switch.",
			appearance: "A 2px `primary` ring around the hit area, clear of the track.",
		},
		{
			state: "Disabled",
			how: "`disabled`.",
			appearance:
				"Track `control-disabled-border` (off) or `control-primary-disabled-bg` (on), knob `control-disabled-text`; no hover fill, no pointer events.",
		},
		{
			state: "Changing",
			how: "`checked` flips.",
			appearance:
				"The track colour fades and the knob slides; both are instant under `prefers-reduced-motion`.",
		},
	],
	accessibility: [
		'A native `<button type="button">` with `role="switch"` and `aria-checked`, so screen readers announce a switch and its state.',
		"`label` is the accessible name. The visible text beside the switch is not linked to it, so the label must say the same thing (or more, such as the item's name).",
		"There is no visible On/Off text; the state is carried by `aria-checked` and the knob position (`packages/ui/SPEC.md`).",
		"The track and knob are `aria-hidden`; `data-active` mirrors `checked` for tests.",
		"`disabled` is native: the switch leaves the tab order and cannot be activated. Because it also stops pointer events, a tooltip on a disabled switch needs IconTooltip's `wrapTrigger`.",
		"Explain a state or a block with IconTooltip and the same text in `aria-description`, as the Skills dialog does.",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action: "Moves focus to and from the switch; the focus ring appears.",
		},
		{ keys: "Space / Enter", action: "Toggles the state (native button activation)." },
	],
	rules: [
		{
			id: "SWT-1",
			text: "Use a switch only for an on/off state that applies when flipped or that a form submits. Actions are Buttons; choosing between views is ToggleSegment or a `selected` Button (LIB-3).",
		},
		{
			id: "SWT-2",
			text: "Always pass `label` from a locale key that names the setting; in a list, name the item (`settings.extensions.enable`, `mcp.server.enable`). Place the visible name beside the switch yourself.",
		},
		{
			id: "SWT-3",
			text: "Never add On/Off text next to the switch. When the state or a block needs words, use IconTooltip and pass the same text as `aria-description`; wrap a disabled switch with `wrapTrigger`.",
		},
		{
			id: "SWT-4",
			text: "Keep it controlled: `checked` comes from the authoritative value. A persisted setting follows the store's broadcast value instead of flipping optimistically (`apps/web/src/panels/SPEC.md`).",
		},
		{
			id: "SWT-5",
			text: "Disable the switch while its change or the surrounding submit is in flight (`disabled={busy}`) instead of hiding it.",
		},
		{
			id: "SWT-6",
			text: '`className` is for placement only; never restyle the track or knob. New switches use Switch, not SettingsSwitch or a hand-rolled `role="switch"` button (LIB-2, audit F-04).',
		},
	],
	examples: [
		{
			id: "basic",
			title: "Basic",
			description: "A switch with its visible name beside it; `label` repeats the name.",
		},
		{
			id: "dialog-option",
			title: "Dialog option",
			description: "A title, a detail line and the switch, as in the Create project dialog.",
		},
		{
			id: "busy",
			title: "Disabled while busy",
			description: "The Merge PR option is disabled while the merge runs.",
		},
		{
			id: "item-list",
			title: "Per-item list",
			description: "One switch per extension; each label names its item.",
		},
		{
			id: "row-actions",
			title: "Beside row actions",
			description:
				"An MCP server row: the switch sits between the row's action and its menu, and its label says what the next flip does.",
		},
		{
			id: "tooltip-reason",
			title: "Tooltip and blocked reason",
			description:
				"IconTooltip explains the state; a blocked switch is disabled and keeps its tooltip through `wrapTrigger`.",
		},
		{
			id: "disabled",
			title: "Disabled",
			description: "Off and on with the disabled colour roles.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/ExtensionsSettings.tsx",
			note: "One switch per extension row, label `settings.extensions.enable`.",
		},
		{
			file: "apps/web/src/panels/McpSettings.tsx",
			note: "Server enable switch beside the row actions; label depends on scope and state; disabled while busy or locked.",
		},
		{
			file: "apps/web/src/chat/SkillsDialog.tsx",
			note: "`SkillSwitch`: IconTooltip with `wrapTrigger` while disabled and `aria-description` from the tooltip.",
		},
		{
			file: "apps/web/src/panels/MergePrDialog.tsx",
			note: "Delete-branch option in the merge form, disabled while merging.",
		},
		{
			file: "apps/web/src/panels/CreateProjectDialog.tsx",
			note: "Draft-the-specs option with a title and detail line.",
		},
	],
} satisfies ComponentDoc;
