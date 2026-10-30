import type { ComponentProps } from "react";
import type { Collapsible } from "@/chat/tools/Collapsible";
import type { ComponentDoc, PropDoc } from "../types";

type CollapsibleProps = ComponentProps<typeof Collapsible>;

export const collapsible = {
	slug: "collapsible",
	name: "Collapsible",
	group: "Data display",
	source: "apps/web/src/chat/tools/Collapsible.tsx",
	preview: "preview",
	tag: "<Collapsible",
	importLine: 'import { Collapsible, countLines } from "@/chat/tools/Collapsible";',
	summary:
		"The “Show all N lines” fold for long tool output inside a chat tool card. Above 24 lines it caps the content at `max-h-384` behind a bottom fade and adds a text toggle; at 24 lines or fewer it renders the children untouched. It owns the cap, the fade, the toggle label and the remembered fold state; the call site provides a stable tool-call-derived `id`, the content's line count (usually `countLines(text)`) and the content itself.",
	whenToUse: [
		"The body of a chat tool renderer whose output can run long: file contents (`read`, `write`), edit diffs, web results, MCP arguments and output, spec tool results, a subagent's task.",
		"Content whose length you can count in lines before rendering — pass the count; the component never measures.",
		"Inside the transcript, where the fold must survive virtualization remounts and keep the reader's scroll anchor (it registers with `FoldGeometryProvider` through `useFold`).",
	],
	alternatives: [
		{
			name: "QuietScrollArea",
			when: "Content that should scroll inside a fixed region rather than grow to its full length on demand.",
		},
		{
			name: "TreeRow",
			when: "A hierarchy the user expands folder by folder, not one long block of text.",
		},
		{
			name: "Button",
			when: "A disclosure outside the chat tool renderers; Collapsible's toggle, fade and fold cache are specific to tool output.",
		},
	],
	anatomy: [
		{
			part: "Pass-through",
			description:
				"At `lines` ≤ 24 the children are returned as they are — no wrapper, no toggle, no `data-testid`.",
		},
		{
			part: "Root",
			description:
				'A `flex flex-col gap-4` `<div data-testid="collapsible" data-chat-fold-root>` carrying `data-expanded`.',
		},
		{
			part: "Clip",
			description:
				"Wraps the children. Collapsed it is `relative max-h-384 overflow-hidden`; expanded it has no class and the content grows to full height.",
		},
		{
			part: "Fade",
			description:
				"Collapsed only: a `pointer-events-none` `h-32` strip pinned to the clip's bottom edge, painted with `fadeClass` (a gradient from `container-header-bg` to transparent by default).",
		},
		{
			part: "Toggle",
			description:
				'A native `<button data-testid="collapsible-toggle">` below the clip, `self-start`, `text-primary` `tr-text-metadata`, underlined on hover. Its label is “Show all N lines” (`tools.collapsible.showAll`, pluralised by `lines`) or “Show less” (`tools.collapsible.showLess`).',
		},
	],
	props: {
		id: {
			type: "string",
			description:
				"Required. The key in the shared `foldState` cache and the fold anchor id. Derive it from the tool call (`<toolCallId>:content`, `<toolCallId>:task`) so the user's toggle survives re-derivation and virtualization; two folds with the same id share one remembered value.",
		},
		lines: {
			type: "number",
			description:
				"Required. The content's line count. Above 24 the content folds; it is also the N in “Show all N lines”. Use `countLines(text)` (a trailing newline adds no line) or sum the parts you render.",
		},
		children: {
			type: "ReactNode",
			description:
				"The content: a `CodeBlock`, `Markdown`, `ToolArgList`, a diff. It keeps its own surface; the fold adds none.",
		},
		fadeClass: {
			type: "string",
			default: '"bg-[linear-gradient(to_top,var(--container-header-bg),transparent)]"',
			description:
				"Background classes for the fade strip. The default ends on `container-header-bg`, the code-block surface; pass the gradient to `--container-elevated-bg` when the content's bottom edge is the card itself (EditCard's coloured diff rows).",
		},
	} satisfies Record<keyof CollapsibleProps, PropDoc>,
	states: [
		{
			state: "Short",
			how: "`lines` ≤ 24.",
			appearance: "The children only. No cap, fade or toggle.",
		},
		{
			state: "Collapsed",
			how: "`lines` > 24 and no remembered toggle for `id` (the initial state).",
			appearance:
				"Content clipped at `max-h-384` with the fade over its last `h-32`; toggle reads “Show all N lines”; `data-expanded=false`, `aria-expanded=false`.",
		},
		{
			state: "Expanded",
			how: "Click the toggle (or remount after the user expanded the same `id`).",
			appearance:
				"Full-height content, no fade; toggle reads “Show less”; `data-expanded=true`, `aria-expanded=true`.",
		},
		{
			state: "Toggle hover",
			how: "Pointer over the toggle.",
			appearance: "Label underlined (`hover:underline`); colour unchanged.",
		},
		{
			state: "Toggle keyboard focus",
			how: "Tab to the toggle.",
			appearance:
				"The browser's default focus outline — the toggle sets no `focus-visible` ring of its own.",
		},
		{
			state: "Disabled, loading, error",
			how: "—",
			appearance:
				"No distinct treatment. Running and empty states are rendered by the tool renderer instead of a Collapsible; error output keeps the colour its content sets.",
		},
	],
	accessibility: [
		"The toggle is a native `<button>` with `aria-expanded`; its visible label is its accessible name and changes between “Show all N lines” and “Show less”.",
		"The toggle has no `aria-controls`; it sits directly below the content it reveals.",
		"Collapsed content is clipped visually only — it stays in the DOM, so screen readers and in-page search still reach the hidden lines.",
		"The fade is `pointer-events-none` and carries no text, so it never intercepts clicks or selection.",
		"Toggling goes through the transcript's fold-geometry seam, which keeps the reader's anchor in place instead of jumping the scroll position.",
	],
	keyboard: [
		{ keys: "Tab / Shift+Tab", action: "Moves focus to and from the toggle." },
		{ keys: "Enter / Space", action: "Expands or collapses the content." },
	],
	rules: [
		{
			id: "COL-1",
			text: "Use Collapsible for long output inside chat tool renderers only; it is the tool-output fold, not a general disclosure.",
		},
		{
			id: "COL-2",
			text: "Give every fold a stable id derived from the tool call (`<toolCallId>:content`, `<toolCallId>:task`, a per-part suffix) — never an index, a random value or a content hash — so a manual toggle survives streaming and virtualization.",
		},
		{
			id: "COL-3",
			text: "Pass the real line count of what you render: `countLines(text)` for one block, the sum of the parts for a list (as McpArgs and EditCard do). Do not measure pixels or pre-truncate the content.",
		},
		{
			id: "COL-4",
			text: "Wrap only real output. Running and empty states are one-line messages rendered instead of the fold, never inside it; long error output may fold (spec and MCP results do), a one-line error does not need to.",
		},
		{
			id: "COL-5",
			text: "Keep the default fade for content that ends on a code-block surface; override `fadeClass` only to match the surface the content actually ends on, and never to add another colour.",
		},
		{
			id: "COL-6",
			text: "Do not nest Collapsibles or put one around a whole tool card; the ToolCard header already folds the card.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Long file output",
			description: "A 40-line read result, capped behind the fade with “Show all 40 lines”.",
		},
		{
			id: "read-output",
			title: "Read and write cards",
			description:
				"`CodeBlock` content counted with `countLines`, keyed `<toolCallId>:content` — the ReadCard and WriteCard pattern.",
		},
		{
			id: "markdown-result",
			title: "Web result",
			description: "A long Markdown answer from a web tool, folded with the default fade.",
		},
		{
			id: "tool-args",
			title: "Summed line count",
			description:
				"MCP arguments: the line count is the sum of every argument's lines, so the fold matches what is rendered.",
		},
		{
			id: "edit-card",
			title: "Edit diff with its own fade",
			description:
				"The real EditCard: the diff's coloured rows end on the card, so it passes a `fadeClass` ending on `container-elevated-bg`.",
		},
		{
			id: "threshold",
			title: "Threshold",
			description:
				"24 lines render as they are; 25 lines fold. The toggle label counts the lines you pass.",
		},
		{
			id: "remembered",
			title: "Remembered fold",
			description:
				"Expand, then collapse and reopen the tool card: the same `id` restores the expanded state on remount.",
		},
	],
	usages: [
		{
			file: "apps/web/src/chat/tools/ReadCard.tsx",
			note: "File contents in a `CodeBlock`, keyed `<toolCallId>:content`.",
		},
		{
			file: "apps/web/src/chat/tools/EditCard.tsx",
			note: "Old and new lines counted together, with the `container-elevated-bg` fade.",
		},
		{
			file: "apps/web/src/chat/tools/web/WebResultBody.tsx",
			note: "Markdown web results; running, error and empty states stay outside the fold.",
		},
		{
			file: "apps/web/src/chat/tools/mcp/McpCardParts.tsx",
			note: "MCP arguments (summed line count) and MCP output.",
		},
		{
			file: "apps/web/src/chat/tools/subagent/AgentCard.tsx",
			note: "A subagent's task text, keyed `<toolCallId>:task`.",
		},
	],
} satisfies ComponentDoc;
