import type { SettingsSwitch } from "@/panels/SettingsSwitch";
import type { ComponentDoc, PropDoc } from "../types";
import { switchComparisonDescription, switchComparisonTable } from "./switch";

type Props = Parameters<typeof SettingsSwitch>[0];

export const settingsSwitch = {
	slug: "settings-switch",
	name: "SettingsSwitch",
	group: "Data entry",
	source: "apps/web/src/panels/SettingsSwitch.tsx",
	preview: "basic",
	tag: "<SettingsSwitch",
	importLine: 'import { SettingsSwitch } from "@/panels/SettingsSwitch";',
	summary:
		'The Settings dialog\'s own on/off control: a `<button role="switch">` whose body is the track, with a sliding knob. It is a second implementation beside Switch from `packages/ui` with the same geometry but a different look and a closed API — five props, no `className`, `ref` or extra attributes. The call site provides `checked`, the accessible `label`, a required `testId`, and the visible text, almost always as the `control` of a SettingsRow.',
	whenToUse: [
		"Maintaining an existing Settings page that already uses it (Privacy, Notifications, Models, Subagents, Visible models, Line width, JetBrains AI quota).",
		"A host-persisted on/off setting shown as the `control` of a SettingsRow, whose `checked` follows the saved value.",
		"A per-item visibility switch in a Settings list, such as Visible models.",
	],
	alternatives: [
		{
			name: "Switch",
			when: "Any new switch, including in Settings (Extensions and MCP servers already use it), and anywhere you need a hover state, `className`, `ref`, a tooltip trigger or extra ARIA. See *SettingsSwitch and Switch* below for the differences.",
		},
		{
			name: "SegmentedControl",
			when: "A setting with more than two named values.",
		},
		{
			name: "SettingsRadioCards",
			when: "Choosing one of a few options that each need a title and description.",
		},
	],
	anatomy: [
		{
			part: "Track",
			description:
				'The `<button type="button" role="switch">` itself: a rounded track, `border-default` off and `primary` on. It also carries the focus ring.',
		},
		{
			part: "Knob",
			description:
				"A round span that slides to the end when on; `container-workspace-bg` in both states.",
		},
		{
			part: "Visible text",
			description:
				"Not part of the component; usually the `label` and `description` of the surrounding SettingsRow.",
		},
	],
	props: {
		checked: {
			type: "boolean",
			description: "Required. The current state; the switch keeps no state of its own.",
		},
		disabled: {
			type: "boolean",
			default: "false",
			description:
				"Native disabled: no focus, no activation, no pointer events; the whole control is dimmed with `opacity-50`.",
		},
		label: {
			type: "string",
			description:
				"Required. The accessible name (`aria-label`). Use the row's locale key, or a more specific one (`settings.subagents.allowGlobally`, `settings.visibleModels.show`).",
		},
		testId: {
			type: "string",
			description:
				"Required. Rendered as `data-testid`; the e2e handle of the setting (`notifications-toggle`, `review-autofix-toggle`).",
		},
		onChange: {
			type: "(checked: boolean) => void",
			description: "Required. Called on every click with the next state (`!checked`).",
		},
	} satisfies Record<keyof Props, PropDoc>,
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. Click the first row, or click into the page and press Tab to see keyboard focus; there is no hover treatment. Disabled is the real prop.",
		},
		{
			id: "compare",
			title: "SettingsSwitch and Switch",
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
			appearance: "`primary` track; the knob stays `container-workspace-bg` and moves to the end.",
		},
		{ state: "Hover", how: "Pointer over the switch.", appearance: "No distinct treatment." },
		{ state: "Pressed", how: "Pointer down or Space held.", appearance: "No distinct treatment." },
		{
			state: "Keyboard focus",
			how: "Tab to the switch.",
			appearance:
				"A 2px `primary` ring flush around the track; on the `primary` track it reads as a thicker edge.",
		},
		{
			state: "Disabled",
			how: "`disabled`.",
			appearance: "The enabled colours at `opacity-50`; no pointer events.",
		},
		{
			state: "Changing",
			how: "`checked` flips.",
			appearance: "The track colour fades and the knob slides; there is no reduced-motion variant.",
		},
	],
	accessibility: [
		'A native `<button type="button">` with `role="switch"` and `aria-checked`; `data-active` mirrors `checked`.',
		"`label` is the accessible name. The SettingsRow text is not linked to the switch, so the label must name the same setting.",
		"No visible On/Off text; the state is `aria-checked` and the knob position.",
		"`disabled` is native: the switch leaves the tab order and cannot be activated.",
		"It accepts no other attributes and no `ref`, so it cannot carry `aria-description` or be a Radix `asChild` trigger; use Switch when that is needed.",
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
			id: "SSW-1",
			text: "Do not add new SettingsSwitch call sites; new switches, in Settings too, use Switch. SettingsSwitch is a duplicate implementation tracked for consolidation (audit F-04, `buttonUsage.test.ts`).",
		},
		{
			id: "SSW-2",
			text: "Place it as the `control` of a SettingsRow (or beside its own visible name in a list row); it has no visible text of its own.",
		},
		{
			id: "SSW-3",
			text: "`label` comes from the row's locale key or a more specific one; in a list it names the item (`settings.visibleModels.show`).",
		},
		{
			id: "SSW-4",
			text: "Give every switch a stable `testId` named after the setting (`<setting>-toggle`); it is required because e2e tests address settings by it.",
		},
		{
			id: "SSW-5",
			text: "`checked` is the saved value: `onChange` writes the setting and the switch follows the broadcast, never an optimistic local copy. Report a failed write with a toast or an inline error and leave `checked` on the saved value.",
		},
		{
			id: "SSW-6",
			text: "Do not wrap, restyle or patch it to get hover, tooltips, `aria-description` or a different disabled look — those are what Switch already provides.",
		},
	],
	examples: [
		{
			id: "basic",
			title: "Basic",
			description: "The control of a SettingsRow, as in Privacy.",
		},
		{
			id: "description",
			title: "With a description",
			description: "A SettingsRow with a detail line, as in Notifications.",
		},
		{
			id: "group",
			title: "In a settings group",
			description: "Two switch rows in the Models page's Review group.",
		},
		{
			id: "state-description",
			title: "Description follows the state",
			description:
				"Subagents: the row's description explains the current state, and `label` is more specific than the row text.",
		},
		{
			id: "item-list",
			title: "Per-item list",
			description: "Visible models: one switch per model, each label names its model.",
		},
		{
			id: "host-saved",
			title: "Saved through the host",
			description:
				"`checked` is the saved value, so the knob moves when the mocked host confirms the write, not on click.",
		},
		{
			id: "disabled",
			title: "Disabled",
			description: "Off and on; the whole control is dimmed with `opacity-50`.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/PrivacySettings.tsx",
			note: "Analytics sharing as a SettingsRow control; a failed write toasts.",
		},
		{
			file: "apps/web/src/panels/ModelsSettings.tsx",
			note: "Agent-triggered review and automatic fix cycle rows in the Review group.",
		},
		{
			file: "apps/web/src/panels/SubagentSettings.tsx",
			note: "Global and per-workspace allow switches; the workspace one sits beside a source tag.",
		},
		{
			file: "apps/web/src/panels/VisibleModelsSettings.tsx",
			note: "One switch per model in the visibility list.",
		},
		{
			file: "apps/web/src/panels/AnalyticsPreferences.tsx",
			note: "Shared by Settings and the analytics consent dialog, with `disabled`.",
		},
		{
			file: "apps/web/src/panels/JetBrainsAiCard.tsx",
			note: "Show-quota switch whose failed save shows an inline error.",
		},
	],
} satisfies ComponentDoc;
