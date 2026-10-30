import type { SettingsNoticeProps, SettingsNoticeVariant } from "@/panels/SettingsNotice";
import type { ComponentDoc, PropDoc } from "../types";

export const settingsNoticeVariantDocs = {
	neutral:
		"An empty state with no severity — no project templates yet. Muted icon; usually with `hideIcon`.",
	info: "A condition the user can resolve or should know about: permission not granted yet, open a project first, no global templates yet.",
	success: "A confirmed good state. No production call site yet.",
	warning:
		"A setting that is degraded or not working as configured: GitHub CLI not connected, notifications blocked, a theme fallback, a theme file that failed to load.",
	error:
		"A setting that failed outright. No production call site yet; theme-file problems use `warning`.",
} as const satisfies Record<SettingsNoticeVariant, string>;

export const settingsNoticeIcons = {
	neutral: "RiInformationLine",
	info: "RiInformationLine",
	success: "RiCheckLine",
	warning: "RiAlertLine",
	error: "RiErrorWarningLine",
} as const satisfies Record<SettingsNoticeVariant, string>;

export const settingsNotice = {
	slug: "settings-notice",
	name: "SettingsNotice",
	group: "Feedback",
	source: "apps/web/src/panels/SettingsNotice.tsx",
	preview: "preview",
	tag: "<SettingsNotice",
	importLine: 'import { SettingsNotice } from "@/panels/SettingsNotice";',
	summary:
		"The one inline notice inside a Settings page: a `rounded-sm` block on the control background with a severity icon, a line of text and an optional action row beneath it. It owns the surface, the icon per variant and its colour, the text type and the action row; the call site provides the variant, the message and at most one action, and places the notice in its group. How it relates to toasts and other notices is the [Notices](#/notices) pattern.",
	whenToUse: [
		"A lasting condition on a Settings page that explains why a section does not work as expected: the GitHub CLI is not connected, browser notifications are blocked or not yet allowed.",
		"A section that cannot show its content yet, with the next step: open a project to manage its templates, add starter templates.",
		"A short empty state inside a Settings group (`neutral`, often `hideIcon`).",
		"One notice per problem in a list of issues — one per theme file that failed to load, one per theme fallback.",
	],
	alternatives: [
		{
			name: "Toast",
			when: "Reporting the result of an action, such as a rejected save. Settings toasts a rejected auto-save and keeps the authoritative value.",
		},
		{
			name: "SettingsRow and SettingsGroup",
			when: "The text is a setting's description rather than a condition — put it in the row's or group's description.",
		},
		{
			name: "StaleComposerNotice",
			when: "A condition in the chat composer, not in Settings.",
		},
		{
			name: "ConfirmDialog",
			when: "The user must decide before something happens.",
		},
	],
	anatomy: [
		{
			part: "Container",
			description:
				"A `div` with `data-variant` (and `data-testid` from `testId`): `flex items-start gap-8`, `rounded-sm`, `px-12 py-8` on `control-bg` for every variant. No border and no landmark role.",
		},
		{
			part: "Icon",
			description:
				"A `shrink-0` span nudged `mt-2` to the first line, coloured by the variant (`text-muted` for `neutral`, `text-feedback-*` otherwise). It holds the variant's default glyph at `size-14`, or `icon`. Omitted with `hideIcon`.",
		},
		{
			part: "Text",
			description:
				"The children in a `div` with `tr-text-ui` and `text-default`, inside a `flex min-w-0 flex-1 flex-col gap-4` column. A secondary line is the call site's own `tr-text-metadata text-text-muted` element.",
		},
		{
			part: "Action row",
			description:
				"`action`, when given, in a `flex items-center gap-8` row under the text, aligned with its start.",
		},
	],
	props: {
		variant: {
			type: '"neutral" | "info" | "success" | "warning" | "error"',
			description:
				"Required. Picks the default glyph and its colour. The surface is the same for every variant.",
		},
		children: {
			type: "ReactNode",
			description:
				"The message, set in `tr-text-ui` / `text-default`. A string, or a `<p>` per line when there is a muted second line; inline code through `<T components>` with `tr-code-text`.",
		},
		action: {
			type: "ReactNode",
			description:
				'One control under the text: a `Button variant="outline" size="m"`, or a disclosure for instructions. `null` renders no row.',
		},
		icon: {
			type: "ReactNode",
			description:
				"Replaces the default glyph for a meaning more specific than the severity (`RiMagicLine` on the starter-templates notice). Size it `size-14`; the colour still comes from `variant`.",
		},
		hideIcon: {
			type: "boolean",
			default: "false",
			description:
				"Drops the icon so the text starts at the padding — for a `neutral` empty state.",
		},
		testId: {
			type: "string",
			description: "Sets `data-testid` on the container. Every production notice sets one.",
		},
		className: {
			type: "string",
			description:
				"Placement only — margins or width. The page's separator and padding belong on a wrapper, as the call sites do.",
		},
	} satisfies Record<keyof SettingsNoticeProps, PropDoc>,
	variants: settingsNoticeVariantDocs,
	sections: [
		{
			id: "variants",
			title: "Variants",
			description:
				"Every cell is the real SettingsNotice. The surface is the same for all five; the variant picks the glyph and its colour.",
		},
	],
	states: [
		{
			state: "Default",
			how: "Rendered.",
			appearance: "Icon, text and the optional action row on `control-bg`.",
		},
		{
			state: "With action",
			how: "`action`.",
			appearance:
				"A second row under the text, at the text's start; the action's own states (loading, disabled) apply.",
		},
		{
			state: "Custom icon",
			how: "`icon`.",
			appearance: "The given glyph in the variant's colour.",
		},
		{
			state: "No icon",
			how: "`hideIcon`.",
			appearance: "Text and action start at the left padding.",
		},
		{
			state: "Hover, focus, disabled",
			how: "—",
			appearance: "No distinct treatment: the notice is not interactive; only its action is.",
		},
	],
	accessibility: [
		"A plain `div` with no role and no live region: it is read in page order, and appearing or changing is not announced. Say what matters in the text.",
		'The glyph is decorative and carries no label; the words must state the condition ("Notifications are blocked by your browser"), never just the icon.',
		'The action is an ordinary Button (or disclosure button) in the tab order after the text; give it a label that names the fix ("Allow in browser", "Refresh").',
		"Use the native semantics of the children — a `<p>` per line, `<code>` for commands and paths.",
	],
	keyboard: [
		{ keys: "Tab / Shift+Tab", action: "Skips the notice itself and reaches its action." },
		{ keys: "Enter / Space", action: "Activates the action." },
	],
	rules: [
		{
			id: "SNT-1",
			text: "Use SettingsNotice for every inline status inside Settings — never a hand-made tinted box. Outside Settings use the surface's own notice; for an action's result use a Toast.",
		},
		{
			id: "SNT-2",
			text: "Pick the variant by meaning: `warning` for something configured that does not work, `info` for a condition the user can resolve, `neutral` for an empty state. Never colour the text or the surface to signal severity.",
		},
		{
			id: "SNT-3",
			text: 'At most one action, passed through `action`: a `Button variant="outline" size="m"` (with `loading`/`spinIcon` for a refresh). Never a filled or toned button, and never place the action beside the text yourself.',
		},
		{
			id: "SNT-4",
			text: "Keep the text short and from locale keys. A second line is `tr-text-metadata text-text-muted`; commands and paths go through `<T components>` as `tr-code-text`.",
		},
		{
			id: "SNT-5",
			text: "Replace the icon only with a domain glyph at `size-14`; drop it (`hideIcon`) only on a `neutral` empty state.",
		},
		{
			id: "SNT-6",
			text: "The page places the notice: a wrapper adds the separator and padding (`border-b py-12`), and several notices stack in `flex flex-col gap-4`, one per item, each with a `testId`.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Basic",
			description:
				"A warning with a command in the text and a Refresh action that spins in place — Local GitHub when the CLI is not signed in.",
		},
		{
			id: "variants",
			title: "Variants",
			description: "Every variant with its default glyph. Only the icon changes colour.",
		},
		{
			id: "permission",
			title: "With an action",
			description:
				"An info notice whose one outline action fixes the condition — notification permission not granted yet.",
		},
		{
			id: "two-lines",
			title: "Two lines",
			description:
				"A message and a muted second line with an inline path — no project open in Templates.",
		},
		{
			id: "custom-icon",
			title: "Custom icon",
			description:
				"A domain glyph instead of the info icon and an action that fills the empty state — no global templates yet.",
		},
		{
			id: "hide-icon",
			title: "Empty state without an icon",
			description: "`neutral` with `hideIcon` for an empty list.",
		},
		{
			id: "issue-list",
			title: "One notice per issue",
			description:
				"Theme files that failed to load: a stack of warnings, each naming the file, the problem and the detail.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/GithubSettings.tsx",
			note: "Not connected: `warning` with a `gh auth login` command and the Refresh button as `action`.",
		},
		{
			file: "apps/web/src/panels/NotificationsSettings.tsx",
			note: "Permission not granted (`info` + Allow in browser) and blocked or unsupported (`warning` + How to enable disclosure).",
		},
		{
			file: "apps/web/src/panels/TemplatesSettings.tsx",
			note: "No project (`info`, two lines), no project templates (`neutral` + `hideIcon`), no global templates (custom icon + Add starter templates).",
		},
		{
			file: "apps/web/src/panels/CustomThemesSettings.tsx",
			note: "One `warning` per theme file that failed to load.",
		},
		{
			file: "apps/web/src/panels/AppearanceSettings.tsx",
			note: "One `warning` per configured theme that fell back to another.",
		},
	],
} satisfies ComponentDoc;
