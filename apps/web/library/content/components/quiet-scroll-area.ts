import type { ComponentProps, HTMLAttributes } from "react";
import type { QuietScrollArea, QuietScrollFrame } from "@/components/QuietScrollArea";
import type { ComponentDoc, PropDoc } from "../types";

type AreaProps = ComponentProps<typeof QuietScrollArea>;
type FrameProps = ComponentProps<typeof QuietScrollFrame>;
type OwnProps = Exclude<keyof AreaProps, keyof HTMLAttributes<HTMLDivElement> | "key">;
/** QuietScrollFrame shares `surface` and `axis`; only what it adds is listed under its name. */
type FrameOwnProps = `QuietScrollFrame.${Exclude<keyof FrameProps, keyof AreaProps>}`;

export const quietScrollArea = {
	slug: "quiet-scroll-area",
	name: "QuietScrollArea",
	group: "Layout",
	source: "apps/web/src/components/QuietScrollArea.tsx",
	preview: "preview",
	tag: "<QuietScrollArea",
	importLine: 'import { QuietScrollArea } from "@/components/QuietScrollArea";',
	summary:
		"The scroll container for tool panes: an ordinary native scroll viewport whose thumb stays hidden until the user shows intent, with a soft curtain on every clipped edge. It owns the viewport, the intent signal (hover, focus inside, active scrolling, a pointer drag, touch), overflow measurement and the curtains; the thumb's look is the app-wide scrollbar in `styles/global.css`. The call site provides a sized host, the inset (`viewportClassName`) and the `surface` the curtains fade into. `QuietScrollFrame`, from the same module, gives a third-party scroller it does not own (xterm) the same treatment.",
	whenToUse: [
		"The scrolling body of a side or bottom pane: Projects, Specs, Files, Changes and Review.",
		"Any long list on `container-sidebar-bg` whose header or toolbar stays fixed above it (put the header outside the area).",
		"A caller that saves and restores the scroll position needs the native viewport: `viewportRef` (`panels/RememberedScrollArea`).",
		"A third-party view with its own scroll element on `container-terminal-bg` — use `QuietScrollFrame` with `viewportSelector` and, when the library knows its position better than the DOM, `edges`.",
	],
	alternatives: [
		{
			name: "A plain `overflow-auto` element",
			when: "Content scrolls on a surface other than the sidebar or terminal (a dialog body, the chat transcript, an editor); it gets the same quiet thumb from the global scrollbar rule, without curtains.",
		},
		{
			name: "Collapsible",
			when: "A long block inside a scrolling transcript should be capped and expanded on demand instead of scrolling on its own.",
		},
		{
			name: "Resizable",
			when: "The user should be able to give the region more room; put the QuietScrollArea inside the panel.",
		},
		{
			name: "LoadingRegion and SkeletonRows",
			when: "The pane's content is still loading; render the placeholder in place of the list.",
		},
	],
	anatomy: [
		{
			part: "Host",
			description:
				"The outer `div` with `quiet-scroll-host relative min-h-0 min-w-0 overflow-hidden` and `data-quiet-scroll-surface`. Receives `className` and every other `div` attribute; it needs a height from its parent (`h-full`, or `min-h-0 flex-1` in a column).",
		},
		{
			part: "Viewport",
			description:
				"The inner `div` with `quiet-scroll-viewport size-full overflow-auto` that actually scrolls and holds `children`. It takes `viewportClassName` (the pane inset, `p-panel-inset`), `viewportTestId` and `viewportRef`, and carries `data-quiet-scroll-intent` while the user shows intent.",
		},
		{
			part: "Thumb",
			description:
				"The native scrollbar, styled once for the whole app in `styles/global.css`: transparent track and resting thumb, `border-default` while the viewport is hovered or carries the intent attribute, `text-muted` while the thumb itself is hovered or dragged.",
		},
		{
			part: "Curtains",
			description:
				'An `aria-hidden`, pointer-transparent overlay (`data-testid="quiet-scroll-cues"`, `z-20`) with four `quiet-scroll-curtain` gradients, `h-16` / `w-16`, from the surface colour to transparent. Each shows (`data-visible`) only on an edge where content is clipped; left and right only with `axis="both"`.',
		},
		{
			part: "QuietScrollFrame",
			description:
				"The same host and curtains around `children` it does not own. It finds the scroll element with `viewportSelector`, puts the intent attribute on it, and either measures it or shows the `edges` it is given; with `edges` it also sets `data-quiet-scroll-overflow-y`, which lets the global CSS reveal xterm's own slider as the same thumb.",
		},
	],
	props: {
		viewportClassName: {
			type: "string",
			description:
				"Classes for the scrolling element: the content inset (`p-panel-inset` in every tool pane). Do not set overflow or a background here.",
		},
		viewportTestId: {
			type: "string",
			description: "`data-testid` for the scrolling element, for tests that scroll it.",
		},
		viewportRef: {
			type: "RefCallback<HTMLDivElement>",
			description:
				"Called with the scrolling element when it mounts (and `null` when it unmounts), so a caller can save and restore `scrollTop`.",
		},
		surface: {
			type: '"sidebar" | "terminal"',
			default: '"sidebar"',
			description:
				"The background the area sits on, which the curtains fade from: `container-sidebar-bg` or `container-terminal-bg`. Always state it; it is never inferred from placement.",
		},
		axis: {
			type: '"vertical" | "both"',
			default: '"vertical"',
			description:
				"`both` also measures horizontal overflow and shows the left and right curtains.",
		},
		"QuietScrollFrame.viewportSelector": {
			type: "string",
			description:
				"Required on QuietScrollFrame. A selector for the third-party scroll element inside `children` (`.xterm-scrollable-element`); the frame follows it if the library replaces it.",
		},
		"QuietScrollFrame.edges": {
			type: "QuietScrollEdges",
			description:
				"`{ top, right, bottom, left }` from the scroller's own model (xterm's `viewportY` / `baseY`). Replaces DOM measurement, and `top || bottom` marks vertical overflow for the xterm slider.",
		},
	} satisfies Record<OwnProps | FrameOwnProps, PropDoc>,
	nativeProps: {
		title: "Host attributes",
		props: {
			children: {
				type: "ReactNode",
				description: "Required. The scrolling content (QuietScrollFrame: the third-party view).",
			},
			className: {
				type: "string",
				description:
					"Merged after the host classes. Size and placement only: `h-full`, `min-h-0 flex-1`, `absolute inset-12`.",
			},
			inert: {
				type: "boolean",
				description:
					"Passed through; the terminal makes its frame `inert` while a start failure covers it.",
			},
		} satisfies Partial<Record<keyof AreaProps | keyof FrameProps, PropDoc>>,
	},
	states: [
		{
			state: "No overflow",
			how: "Content fits the viewport.",
			appearance: "No curtains and no thumb; the area looks like plain content.",
		},
		{
			state: "Clipped edge",
			how: "Content continues past an edge (below at rest, above after scrolling, both in the middle).",
			appearance:
				"A curtain fades in on that edge with the fast transition; it reaches `opacity-100` and fades out again when the edge is reached.",
		},
		{
			state: "At rest",
			how: "No pointer, focus or scrolling in the area.",
			appearance: "The thumb is transparent; only the curtains tell that there is more.",
		},
		{
			state: "Intent",
			how: "Pointer over the area, focus inside it, a scroll in the last moment (wheel, keys, touch), or a pointer drag that started inside and left it.",
			appearance:
				"`data-quiet-scroll-intent` on the viewport; the thumb shows in `border-default`. It hides again a short grace period after scrolling stops.",
		},
		{
			state: "Thumb hover / drag",
			how: "Pointer on the thumb, or dragging it.",
			appearance:
				"The thumb turns `text-muted`; in a high-contrast theme it also fills its gutter.",
		},
		{
			state: "High-contrast theme",
			how: 'A bundled theme with `data-theme-contrast="high"`.',
			appearance:
				"A resting hairline thumb in `text-subtle`; full width in `border-default` on intent.",
		},
		{
			state: "Forced colours",
			how: "OS high-contrast mode (`forced-colors: active`).",
			appearance: "A system-colour thumb at all times; the curtains are removed.",
		},
		{
			state: "Reduced motion",
			how: "`prefers-reduced-motion: reduce`.",
			appearance: "Curtains and thumb change without a transition.",
		},
	],
	accessibility: [
		"The viewport is a plain `div` with native scrolling: no role, no `tabindex` of its own. Keyboard users scroll it by moving focus through its content, and focus inside counts as intent, so the thumb shows while they are there.",
		"The curtains are `aria-hidden` and `pointer-events-none`; they never intercept clicks, selection or a drag on the scrollbar.",
		"Name the pane, not the scroller: the surrounding `<section aria-label>` or tool region labels the content.",
		"Forced-colours mode keeps a system-colour thumb and drops the curtains; high-contrast themes keep a resting hairline so the scrollbar is findable without hovering.",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action:
				"Moves through the content; the browser scrolls the focused element into view and the thumb shows while focus is inside.",
		},
		{
			keys: "↑ / ↓, Page Up / Page Down, Home / End, Space",
			action: "Native scrolling of the viewport when focus is on a non-editable element inside it.",
		},
	],
	rules: [
		{
			id: "QSA-1",
			text: "Use QuietScrollArea for the scrolling body of every side and bottom tool pane; do not add your own `overflow-auto`, scrollbar styles or fade overlays there.",
		},
		{
			id: "QSA-2",
			text: "Match `surface` to the background behind the area — `sidebar` on `container-sidebar-bg`, `terminal` on `container-terminal-bg` — or the curtains will show as bands of the wrong colour.",
		},
		{
			id: "QSA-3",
			text: "Keep headers, toolbars and filters outside the area so they stay fixed; only the list scrolls.",
		},
		{
			id: "QSA-4",
			text: "Size the host from its parent (`h-full`, or `min-h-0 flex-1` in a flex column) and put the inset on `viewportClassName` (`p-panel-inset`), never padding on the host.",
		},
		{
			id: "QSA-5",
			text: "Reach the scrolling element only through `viewportRef` (saving and restoring position); never query the DOM for `.quiet-scroll-viewport`.",
		},
		{
			id: "QSA-6",
			text: "Wrap a scroller you do not own with `QuietScrollFrame` and its `viewportSelector`, and pass `edges` when the library reports its own position — never a QuietScrollArea around a component that scrolls itself.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Files list",
			description: "A tree of TreeRows in a sidebar pane; the bottom curtain shows there is more.",
		},
		{
			id: "pane-header",
			title: "Under a pane header",
			description:
				"The Specs pane: the header stays fixed and the area fills the rest with `min-h-0 flex-1`.",
		},
		{
			id: "short-content",
			title: "Content that fits",
			description: "Review's empty message: no curtains and no thumb.",
		},
		{
			id: "growing-content",
			title: "Growing content",
			description: "Curtains follow the content as rows are added; no prop changes are needed.",
		},
		{
			id: "remembered-scroll",
			title: "Remembered position",
			description:
				"`viewportRef` saves `scrollTop`; hide and show the pane and it reopens where you left it.",
		},
		{
			id: "both-axes",
			title: "Both axes",
			description: '`axis="both"` adds the left and right curtains for wide content.',
		},
		{
			id: "terminal-surface",
			title: "Terminal surface",
			description: '`surface="terminal"` on `container-terminal-bg`.',
		},
		{
			id: "frame",
			title: "Third-party scroller",
			description:
				"`QuietScrollFrame` finds the scroll element with `viewportSelector` and shows the `edges` the view reports, as the terminal does with xterm.",
		},
	],
	usages: [
		{
			file: "apps/web/src/shell/WorkspaceWorkbench.tsx",
			note: "The Projects and Specs tool bodies: `h-full` with `p-panel-inset`.",
		},
		{
			file: "apps/web/src/shell/ProjectHome.tsx",
			note: "The Projects tree under its pane header on Project Home (`min-h-0 flex-1`).",
		},
		{
			file: "apps/web/src/panels/ReviewPanel.tsx",
			note: "Review's file list below its fixed toolbar.",
		},
		{
			file: "apps/web/src/panels/RememberedScrollArea.tsx",
			note: "Files and Changes: `viewportRef` saves and restores the tree's scroll position.",
		},
	],
} satisfies ComponentDoc;
