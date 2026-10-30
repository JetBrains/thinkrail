import type { ComponentProps } from "react";
import type * as ErrorBoundaryModule from "@/components/ErrorBoundary";
import type { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ComponentDoc, PropDoc } from "../types";

type ErrorBoundaryProps = ComponentProps<typeof ErrorBoundary>;
type ModuleExports = Exclude<keyof typeof ErrorBoundaryModule, "ErrorBoundary">;

export const errorBoundary = {
	slug: "error-boundary",
	name: "ErrorBoundary",
	group: "Feedback",
	source: "apps/web/src/components/ErrorBoundary.tsx",
	preview: "preview",
	tag: "<ErrorBoundary",
	importLine: 'import { ErrorBoundary } from "@/components/ErrorBoundary";',
	summary:
		"The app's React error boundary: when a region throws while rendering or loading a lazy chunk, it replaces that region with a themed, self-contained fallback instead of letting the crash blank the whole app. It owns the fallback, the retry, the reload for a stale chunk, the console log and the hand-off to the installed reporter. The call site provides the region's translated `label`, a stable `reportId` and the `resetKeys` that identify the subtree.",
	whenToUse: [
		"Around every independently mounted region — a workbench tab body, a tool body, a rail pane — so one failing panel degrades on its own.",
		"Once at the root (`main.tsx`) as the last resort, so a crash that escapes every region shows a recoverable screen rather than an empty page.",
		"Around a `Suspense` that loads a lazy chunk (Monaco, xterm, the chat view), so a failed `import()` is caught and steered to a reload.",
	],
	alternatives: [
		{
			name: "LoadingRegion and SkeletonRows",
			when: "The region is waiting for data, not broken; that is the boundary's `Suspense` fallback, not its error fallback.",
		},
		{
			name: "SettingsNotice",
			when: "An expected, recoverable failure inside a settings surface (a list that failed to load, a provider that cannot connect); render it as a state, do not throw.",
		},
		{
			name: "Toast",
			when: "An action failed after a click or a request; event handlers and promises never reach a boundary.",
		},
	],
	anatomy: [
		{
			part: "Boundary",
			description:
				"A class component (`getDerivedStateFromError`). Without an error it renders `children` as is, with no wrapper element.",
		},
		{
			part: "Fallback container",
			description:
				'`role="alert"`, `data-testid="error-boundary-fallback"`: a centred column that fills the region (`h-full`, `min-h-0`, `p-16`, `gap-8`) and scrolls (`overflow-auto`) when the region is too small.',
		},
		{
			part: "Icon",
			description: "`RiAlertLine` at `size-24` in `text-feedback-error`.",
		},
		{
			part: "Title",
			description:
				"`tr-title-compact`, `text-default`: “The {label} panel hit an error” (`components.errorBoundary.panelTitle`) with a `label`, otherwise “Something went wrong” (`components.errorBoundary.title`).",
		},
		{
			part: "Message",
			description:
				"`tr-text-metadata`, `text-muted`, capped at `max-w-[28rem]`: the error's own message, `components.errorBoundary.unexpected` when it is empty, or `components.errorBoundary.chunkError` for a chunk load error.",
		},
		{
			part: "Action",
			description:
				'One Button, `outline` at `m`: **Try again** (`RiArrowGoBackLine`, `data-testid="error-retry"`) clears the error and remounts the children; for a chunk load error **Reload page** (`RiRefreshLine`, `data-testid="error-reload"`) calls `window.location.reload()`.',
		},
	],
	props: {
		children: {
			type: "ReactNode",
			description:
				"The protected region. It is unmounted while the fallback shows, so its local state is lost on recovery.",
		},
		label: {
			type: "string",
			description:
				'The region\'s translated, lowercase name (`t("shell.workbench.panel.editor")`). It is interpolated into the fallback title and the console log; it never reaches the reporter.',
		},
		reportId: {
			type: "string",
			description:
				'A stable, untranslated id (`"editor"`, `"chat"`, `"plan_rail"`) passed to the installed reporter with the error.',
		},
		resetKeys: {
			type: "readonly unknown[]",
			description:
				"The subtree's identity (`[workspaceId, tab.id]`). When the boundary holds an error and any value changes (shallow compare), it resets and renders the children again.",
		},
	} satisfies Record<keyof ErrorBoundaryProps, PropDoc>,
	nativeProps: {
		title: "Module exports",
		props: {
			isChunkLoadError: {
				type: "(error: unknown) => boolean",
				description:
					"True when the message reads as a failed dynamic import: a stale or unreachable Vite chunk, Safari's “Importing a module script failed”, or Vite's outdated optimised dependency. The boundary uses it to choose Reload page over Try again.",
			},
			setErrorBoundaryReporter: {
				type: "(reporter: ((error: Error, reportId: string | undefined) => void) | null) => void",
				description:
					"Installs the one module-wide reporter every boundary calls from `componentDidCatch`; `null` removes it. `main.tsx` wires it to the transport's client error reports. A reporter that throws is ignored.",
			},
		} satisfies Record<ModuleExports, PropDoc>,
	},
	states: [
		{
			state: "Healthy",
			how: "No render error below the boundary.",
			appearance: "The children, untouched; the boundary adds no element.",
		},
		{
			state: "Render error",
			how: "A child throws while rendering, or a lazy component rejects.",
			appearance:
				"The fallback fills the region: error icon, title, the error message and an outline Try again. The crash is logged to the console and handed to the reporter.",
		},
		{
			state: "Render error without a label",
			how: "No `label`.",
			appearance: "Same fallback with the generic title “Something went wrong”.",
		},
		{
			state: "Empty message",
			how: "The thrown error has an empty `message`.",
			appearance:
				"The message line reads “An unexpected error occurred while rendering this view.”",
		},
		{
			state: "Chunk load error",
			how: "`isChunkLoadError(error)` is true (a failed `import()`).",
			appearance:
				"The message explains the stale or unreachable resource and the action is Reload page instead of Try again.",
		},
		{
			state: "Recovered",
			how: "Try again, or a change in `resetKeys` while the error shows.",
			appearance:
				"The children mount again from scratch; if they throw again, the fallback returns.",
		},
		{
			state: "Hover, focus, disabled",
			how: "—",
			appearance: "No distinct treatment of its own; the action is a Button with Button's states.",
		},
	],
	accessibility: [
		'The fallback has `role="alert"`, so assistive technology announces the title and message when a region fails.',
		"The action is a native `<button>` named by its label (Try again or Reload page); the alert icon has no accessible name of its own.",
		"The boundary does not move focus. Focus inside the crashed subtree is lost with it; the user reaches the action with Tab.",
		"The fallback text comes from locale keys; `label` must be translated too, because it is read inside the title.",
	],
	keyboard: [
		{ keys: "Tab / Shift+Tab", action: "Moves focus to and from the fallback's action." },
		{
			keys: "Enter / Space",
			action: "Activates Try again (remounts the region) or Reload page (reloads the app).",
		},
	],
	rules: [
		{
			id: "ERB-1",
			text: "Give every independently mounted region its own boundary, plus the one root wrap in `main.tsx`. Where boundaries go is owned by the shell; panels do not wrap themselves, and a boundary is not for a small leaf control — the fallback fills its region.",
		},
		{
			id: "ERB-2",
			text: "Pass `label` as a translated region noun from a locale key (`shell.workbench.panel.*`) and `reportId` as a stable, untranslated id. Reports group by `reportId`, never by the displayed `label`.",
		},
		{
			id: "ERB-3",
			text: "Set `resetKeys` to the subtree's identity — `[workspaceId, tab.id]` — so switching workspace or tab recovers without a click. Do not put values that change on every render in it.",
		},
		{
			id: "ERB-4",
			text: "Put the `Suspense` for a lazy chunk inside the boundary, with the region's loading placeholder as its fallback, so a failed `import()` is caught and offered a reload.",
		},
		{
			id: "ERB-5",
			text: "A boundary catches render and lazy-load errors only. Failures in event handlers, timers and promises (`transport.request`) never reach it; show them as an error turn, a notice or a Toast, and never throw from a handler to trigger the fallback.",
		},
		{
			id: "ERB-6",
			text: "Report crashes only through the one reporter installed with `setErrorBoundaryReporter`; do not call the transport or a store from a boundary or add a second reporting path.",
		},
		{
			id: "ERB-7",
			text: "Do not hand-roll a fallback or a second boundary class. Expected failures (a list that failed to load) are an ordinary state of the panel, not a thrown error.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Panel boundary",
			description:
				"A labelled workbench region. Open file makes the child throw while rendering; Try again remounts it.",
		},
		{
			id: "without-label",
			title: "Without a label",
			description:
				"The generic title; an error with an empty message falls back to the unexpected-error line.",
		},
		{
			id: "chunk-error",
			title: "Failed lazy chunk",
			description:
				"`Suspense` inside the boundary; a rejected dynamic import shows Reload page, which reloads the page.",
		},
		{
			id: "reset-keys",
			title: "Reset on navigation",
			description:
				"`resetKeys` holds the open tab; crash one file, then switch tabs to recover without a click.",
		},
		{
			id: "regions",
			title: "Regions and the root",
			description:
				"A root boundary around two region boundaries, as the app mounts them: one panel fails, the other keeps working.",
		},
		{
			id: "reporter",
			title: "Reporting a crash",
			description:
				"`setErrorBoundaryReporter` receives the error with the untranslated `reportId`, never the translated label.",
		},
	],
	usages: [
		{
			file: "apps/web/src/main.tsx",
			note: 'The last-resort root boundary (`label` from `app.errorBoundary.label`, `reportId="app"`) and the reporter wired to client error reports.',
		},
		{
			file: "apps/web/src/shell/WorkspaceWorkbench.tsx",
			note: "One boundary per editor, chat, plan, plan-rail, terminal and tool body, each with `resetKeys={[workspaceId, tab.id]}` and a `Suspense` inside.",
		},
	],
} satisfies ComponentDoc;
