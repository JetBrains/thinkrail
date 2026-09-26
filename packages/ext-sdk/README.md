# Writing a ThinkRail UI extension

An extension adds UI to ThinkRail: a panel, a document tab, a topbar item, a card for a tool call, or a
card for a custom chat message. It is a directory of TypeScript that the host builds and loads hot. It runs
in-process with full rights, like a pi extension.

## Where it lives

- `~/.thinkrail/extensions/<name>/` (user; `$THINKRAIL_DATA_DIR/extensions` when that is set). Loads always.
- `<project>/.thinkrail/extensions/<name>/`. Loads only after the user trusts the project. Until then the
  Extensions (puzzle) button lists it as off and offers **Trust project** behind a security warning.

`<name>` matches `^[a-z][a-z0-9-]*$` and equals `name` in the manifest. The first one found wins (user
before project).

```
<name>/
  extension.json   manifest
  index.ts         host half (runs in the ThinkRail host, Node/Bun)
  <surfaceId>.tsx  one view per surface (runs in the browser), default-export a React component
  package.json     optional: own deps, then `bun install` in this dir
```

## Manifest (`extension.json`)

```json
{
  "name": "hello",
  "title": "Hello",
  "surfaces": [
    { "id": "main", "slot": "panel", "title": "Hello" },
    { "id": "badge", "slot": "status" }
  ],
  "permissions": []
}
```

| slot | Where it shows | Extra field |
| --- | --- | --- |
| `tab` | a document tab in the center | |
| `panel` | a tab in the side tool region | |
| `status` | a small item in the topbar | |
| `toolCard` | replaces the chat card of one tool | `"tool": "<tool name>"` |
| `message` | renders one custom message type in chat | `"customType": "<type>"` |

Surface ids use the same pattern as names and are unique. Each surface needs `<id>.tsx`. `permissions` is a
display label only. The user opens `tab` and `panel` surfaces from the Extensions (puzzle icon) menu at the end of the tab strip;
`status`, `toolCard`, and `message` surfaces mount by themselves.

## Host half (`index.ts`)

```ts
import { defineExtension } from "@thinkrail/ext";

export default defineExtension((tr) => {
	let calls = 0;
	tr.publish("calls", calls);
	tr.on("tool_execution_end", () => {
		calls += 1;
		tr.publish("calls", calls);
	});
	tr.action("reset", () => {
		calls = 0;
		tr.publish("calls", calls);
		return { calls };
	});
	return undefined;
});
```

`tr` API. Every registration returns `Off` and is released when this version unloads:

- `tr.name`, `tr.dir`, `tr.log(...args)`: `tr.log` output shows in `ext_logs`.
- `tr.on(eventType, (event, session) => …)`: observe pi events of every top-level session. Useful types:
  `agent_start`, `turn_start`, `turn_end`, `message_end`, `tool_execution_start`,
  `tool_execution_update` (`partialResult` replaces the previous one), `tool_execution_end`,
  `compaction_start`, `compaction_end`, `agent_settled`. A run is finished at `agent_settled`, never `agent_end` (retries and
  compaction may follow `agent_end`). `session` is `{ sessionId, workspaceId, title, isStreaming }`.
- `tr.publish(key, value)`: push a value to views. The host keeps the last value; a view mounted later
  gets it. Values must be JSON. Per-session data goes under one key per session (`tr.publish(sessionId, …)`).
- `tr.unpublish(key)`: forget a key's last value; open views see `undefined`. Use it for data that
  belongs to a session that has closed, so the host does not keep it forever.
- `tr.onWatch((key, watching) => …)`: fires `true` when the first open view reads `useChannel(key)` (on
  any connected window) and `false` when the last one unmounts or its window disconnects. Keys already
  watched fire `true` when this version goes live. `tr.watched()` lists them. Use it to poll or watch
  files only while a view shows the result.
- `tr.action(id, (payload, ctx) => result)`: a function views can call. `ctx` has `projectId`,
  `workspaceId`, `sessionId` of the calling view.
- `tr.store.get(key)` / `tr.store.set(key, value)`: JSON that survives reloads and restarts.
  `set(key, undefined)` deletes the key. The whole store is one file, so keep it bounded.
- `tr.sessions.list()`, `tr.sessions.stats(sessionId)`: live sessions and pi's own stats
  (`SessionStats`: tokens, `cost` in USD, `contextUsage.percent`). Never compute cost yourself. `stats`
  rejects for a session that is not live.
- `tr.workspaces.list()`, `tr.workspaces.get(workspaceId)`: workspaces of open projects as
  `{ workspaceId, projectId, name, branch, path }`. `path` is the checkout on disk, so an action can turn
  `ctx.workspaceId` into the directory the user is looking at.
- `tr.every(ms, fn)`: interval timer.
- `tr.agents`: run subagents as ThinkRail-managed child sessions. See "Subagents" below.
- `tr.pi((pi) => { … })`: a pi extension factory added to every top-level chat session (`pi.registerTool`,
  `pi.on("tool_call", …)`, `pi.sendMessage({ customType, content, display: true, details })` …). Sessions
  pick up a change after their current run settles.
- Return a disposer function to close your own resources (sockets, watchers) on unload.
- The factory may be `async` (for example, to read `tr.store` first). The host waits for it before the
  new version goes live.

Rules: the factory runs again on every reload, so do no side effects outside `tr.*` and the returned
disposer. Keep state in closures or `tr.store`. Do not write files into the extension directory: a change
there triggers a reload. Split code into more files freely: `index.ts` and views can import relative
modules (`./model`), and a pure module can be shared by both halves. Imports available without install: `@thinkrail/ext`, `typebox`,
`@earendil-works/pi-coding-agent`, Node/Bun built-ins.

## Subagents (`tr.agents`)

`tr.agents` runs a task in a hidden child session of a live chat. The child is a delegation child, the
same kind the built-in `Agent` tool makes: it runs in-process, shares the parent's working directory,
and its transcript is stored under the parent. Usage and cost come from pi.

```ts
import { defineExtension } from "@thinkrail/ext";
import { Type } from "typebox";

export default defineExtension((tr) => {
	tr.agents.onEvent((event) => {
		if (event.type === "progress") tr.publish(`agent:${event.agentId}`, event.progress);
		if (event.type === "settled") tr.publish(`agent:${event.agentId}`, event.result);
	});
	tr.pi((pi) => {
		pi.registerTool({
			name: "review_files",
			label: "Review files",
			description: "Review each file with its own subagent",
			parameters: Type.Object({ files: Type.Array(Type.String()) }),
			async execute(_id, { files }, signal, _onUpdate, ctx) {
				const results = await Promise.all(
					files.map((file) =>
						tr.agents.run(
							{ task: `Review ${file}. Reply with findings only.`, role: "reviewer", tools: ["read", "grep"] },
							{ parent: ctx, signal, maxConcurrent: 8 },
						),
					),
				);
				const text = results.map((r, i) => `${files[i]}: ${r.finalText ?? r.errorMessage ?? r.status}`);
				return { content: [{ type: "text", text: text.join("\n\n") }], details: {} };
			},
		});
	});
	return undefined;
});
```

- `tr.agents.spawn(spec, options)` resolves to a handle once the child exists: `id` (the child session
  id), `parentSessionId`, `status` (`queued`, `running`, `completed`, `error`, `aborted`), `progress`,
  `result` (a promise that never rejects; failures resolve with `status: "error"`), `cancel()` (aborts and
  resolves to the result), `onEvent(fn)` (events after the call; `queued` has already fired).
- `tr.agents.run(spec, options)`: `spawn` and await `result`.
- `tr.agents.list()`: this extension's children that have not settled yet.
- `tr.agents.onEvent(fn)`: `queued`, `started`, `progress` (`{ status, model, usage, durationMs, activity }`,
  on each turn and tool start), `settled` (`{ status, finalText, errorMessage, model, usage, durationMs }`).
  Every event carries `agentId`, `parentSessionId`, `role`. `tr.on` never sees child sessions; this is
  how you observe your own.
- `spec`: `task` (required), `role` (a label kept in lineage), `systemPrompt`, `tools` / `excludeTools`
  (pi tool names; default: pi's default set), `model` (`{ provider, id }`, must be a model the parent's
  runtime knows), `thinkingLevel`, `contextFiles` (load AGENTS.md files), `skills` (skill names to
  keep; default none), `extensions` (load the host's curated child extensions), `maxTurns` (asks the
  child to wrap up at the cap, then aborts).
- `options.parent`: the tool's `ctx`, or a live top-level session id (for an action, use
  `ctx.sessionId`). A parent that is not live rejects with `parent session <id> is not live`.
- `options.maxConcurrent`: 1 to 16, default 4. Runs queue first in, first out in one pool per extension
  and parent chat; the latest `spawn` sets the pool's size. The built-in `Agent` tool has its own pool.
- `usage` is for this run only (tokens, `cost` in USD, `turns`, `contextTokens`), taken from pi. Do not
  compute cost yourself.
- A child runs once and is then closed. When the parent session is disposed (chat deleted, host
  shutdown), its children are aborted. When your extension unloads or reloads, every child it started
  is cancelled. `spawn` works only while the extension is live, so not inside the factory body.

Not supported: children listed as chats in the sidebar, follow-up prompts or steering a child, a git
worktree per child, forking the parent's history, the child seeing `tr.pi` tools, text deltas as
events (read the settled `finalText`), and children of children.

## Dependencies

Anything else goes in the extension's own `package.json`, installed in the extension directory, for both
halves. The host half resolves packages from the extension directory; the view build bundles them. Do not
lean on a package that only resolves from a directory above the extension (a monorepo's root
`node_modules`): the same extension copied into `~/.thinkrail/extensions` breaks. Inside a Bun monorepo,
list the extensions directory in the root `workspaces` instead; then `bun install` at the root links its
`node_modules`, and `workspace:*` / `catalog:` versions work (`railmap` gets `pi-spec-graph` and
`typescript` this way). Pin exact versions.

## Views (`<surfaceId>.tsx`)

```tsx
import { remixicon, type SurfaceProps, ui, useAction, useChannel } from "@thinkrail/ext/view";

const { RiRefreshLine } = remixicon;

export default function Main({ host }: SurfaceProps) {
	const calls = useChannel<number>("calls") ?? 0;
	const reset = useAction("reset");
	return (
		<div className="flex flex-col gap-8 p-12">
			<p className="tr-title-compact text-text-default">Tool calls: {calls}</p>
			<p className="tr-text-metadata text-text-muted">session {host.sessionId ?? "none"}</p>
			<ui.Button variant="outline" size="sm" onClick={() => void reset()}>
				<RiRefreshLine className="size-14" /> Reset
			</ui.Button>
		</div>
	);
}
```

From `@thinkrail/ext/view`:

- `useChannel<T>(key)`: the last published value for `key` (the same key the host half publishes; the
  host adds the `<name>:` prefix), then live updates. `undefined` until the first publish.
- `useAction(id)`: returns `(payload?) => Promise<result>`.
- `useHostContext()`: `{ projectId?, workspaceId?, sessionId?, theme }` of the active chat, reactive.
  `host.sessionId` in `SurfaceProps` is the same value. `useAction` sends it as `ctx`, so an action like
  `watch` can make the host half publish data for the chat the user is looking at.
- `openSurface(ext, surfaceId, params?)`: open a `tab`/`panel` surface; it receives `params`.
- `startChat(draft)`: open a new chat in the active workspace with `draft` in its composer (not sent), for
  "fix with agent" buttons.
- `SurfaceProps`: `{ surfaceId, host, params?, toolCall?, message? }`. A `toolCard` view gets
  `toolCall = { toolCallId, toolName, args, result, status }`; a `message` view gets
  `message = { customType, text, details, timestamp }`.
- `ui`: the app's own components: `Button` (`variant`: default, destructive, outline, ghost; `size`:
  default, sm, icon), `Input` (one-line text field), `Textarea`, `Switch`
  (`checked`, `onCheckedChange`; give it an `aria-label`), `Tooltip*`, `IconTooltip`, `Popover*`, `Dialog*`, `DropdownMenu*`,
  `ContextMenu*`, `Command*`.
- `useTheme()`: the selected theme and live preview for this extension (see Themes).
- Types: `SurfaceProps`, `HostContext`, `SessionStats` (the value of a published `tr.sessions.stats`).
- `cn(...classes)`, `remixicon` (all `@remixicon/react` icons: `Ri…Line`, `Ri…Fill`).
- `react`, `react-dom`, `react/jsx-runtime` resolve to the app's React. Other npm deps (see
  Dependencies) are bundled into the view, minified; the inline source map covers only your own files.

## Styling

Tailwind v4 utilities are compiled for each view against the app's theme. Use semantic tokens only:

- Text: `text-text-default`, `text-text-muted`, `text-text-subtle`, `text-primary`,
  `text-feedback-{info,success,warning,error}`.
- Surfaces: `bg-container-workspace-bg`, `bg-container-elevated-bg`, `bg-control-bg`,
  `bg-control-bg-hovered`, `bg-primary-subtle`, `bg-feedback-error-subtle`.
- Borders: `border-border-default`, `border-border-muted`.
- Spacing is in pixels on the scale 0, 2, 4, 8, 12, 16, 24, 32, 40, 64 (`p-12`, `gap-8`). Icon sizes:
  `size-14`, `size-16`. Radius: `rounded-sm`, `rounded-md`, `rounded-lg`.
- Type: `tr-title-compact`, `tr-title-section`, `tr-text-ui`, `tr-text-metadata`, `tr-code-text`.

CSS a view imports (a library's stylesheet, `import "@xyflow/react/dist/base.css"`) lands in the
`components` layer, so your utility classes override it without `!important`.

Positions and sizes computed at runtime (a bar at `left: 42%`) go in `style`; everything else is a
class. No raw hex, no inline `style` objects for colour, no Tailwind palette names (`bg-blue-500`): they do not
follow the theme. An unknown utility renders unstyled without an error.

## Themes

An extension can ship themes in `extension.json`. The user picks one from the Extensions (puzzle icon) menu,
under **Theme**. The choice is saved in the browser, applies without a reload, and follows hot reloads.

```json
"themes": [
  {
    "id": "ember",
    "title": "Ember",
    "mode": "light",
    "tokens": { "--background": "#fbf5ec", "--accent": "#c2410c", "--radius-sm": "6px" },
    "css": "ember.css"
  }
]
```

- `mode` picks the base: the user's built-in theme when it has that appearance, else the default
  built-in theme of that mode. `tokens` override CSS variables on top of the base.
- Token names are checked against the app's token list. A typo fails the load with a hint, e.g.
  `themes[0].tokens["--color-accent"] unknown token; did you mean "--accent"?`. Four groups:
  - **palette** (use these first): `--background`, `--header`, `--content`, `--sidebar`, `--input`,
    `--elevated`, `--hover`, `--border`, `--border-strong`, `--text`, `--muted`, `--hint`, `--accent`,
    `--accent-hover`, `--accent-solid`, `--on-accent`, `--bubble-accent`, `--selection`,
    `--selection-foreground`, `--editor-selection`, `--editor-selection-foreground`, `--info`,
    `--success`, `--danger`, `--warning`. Every role and tint derives from these, so one palette change
    moves all of them.
  - **role**: the semantic tokens from Styling (`--text-default`, `--container-sidebar-bg`,
    `--primary-subtle`, ...). Setting a role changes only that role; tints derived from the palette stay.
  - **radius**: `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg` (lengths: `6px`, `0.5rem`).
  - **font**: `--tr-font-family-interface`, `--tr-font-family-code`, `--tr-font-family-brand` (font-family
    lists; only fonts the system or the app already has).
- Values are plain colors, lengths, or font lists. `url()`, `;`, `{}`, `@`, and `!important` are refused.
- `css` (optional) is a stylesheet in the extension folder, loaded while the theme is active. Use it for
  what tokens cannot express. It cannot load relative files.
- If a theme leaves text unreadable (text on the workspace background under 3:1 contrast), the app drops
  it and falls back to the built-in theme. Unloading the extension falls back too.

`useTheme()` in a view returns `{ active, previewing, select, preview }`:

- `select(themeId | null)`: select one of this extension's themes, or go back to the built-in theme.
- `preview({ mode, tokens } | null)`: apply tokens live without saving them, for editors and pickers.
  It returns `{ ok: false, errors }` for bad tokens or unreadable text and applies nothing. A preview is
  in memory only; it ends on `preview(null)`, on reload of the extension, or when it unloads. Clear it
  when the view unmounts.

## Dev loop

1. Write the files.
2. `ext_validate(name)`: checks the manifest, builds every view, and dry-runs `index.ts` without touching
   the running version. The dry run's `tr.store` writes are thrown away and its `tr.log` lines come back
   in the result. Fix every error it lists.
3. `ext_reload(name)`: loads it as the running version (a new extension loads too). Open
   surfaces swap in place. If it fails, the old version keeps running.
4. `ext_logs(name, since?)`: `tr.log` output, load and build errors, and errors from views crashing in the
   browser. Each line carries its time in ms; pass it as `since` to see only newer entries.

The host also reloads an extension shortly after its files change. Use `ext_reload` anyway to get the
result. A view that crashes shows its error in place with an "Ask agent to fix" button.

## Examples

The ThinkRail source repo ships a full example at `.thinkrail/extensions/timeline/`: a run timeline
panel and a topbar cost item. It shows the patterns above working together:

- `model.ts`: a pure reducer from pi events to spans, shared by the host half and the views.
- `index.ts`: `tr.on` for turns, tools, usage, and compaction; publishes at most every 150 ms with
  `tr.every`; closes a run at `agent_settled`; publishes `cost:<sessionId>` from `tr.sessions.stats`;
  caps spans per session; `tr.unpublish` for closed sessions; keeps settled runs in `tr.store`; a
  `watch` action the views call when the active chat changes.
- `timeline.tsx`, `cost.tsx`: a `panel` and a `status` surface that read the same channels, keyed by
  `host.sessionId`.
- `tsconfig.json`: type-checks the extension against this SDK.

`.thinkrail/extensions/railmap/` is the larger one: a module graph from `SPEC.md` frontmatter next to the
real imports, with drift. It shows own dependencies (`@xyflow/react` and `elkjs` in views, `typescript`
and `pi-spec-graph` in the host half), `tr.workspaces` to find the checkout, an `fs.watch` closed by the
returned disposer, `tr.pi` with a tool (`may_import`) and an `agent_before_settle` hook that appends a
custom message, and all four other slots: `tab`, `panel`, `message`, `toolCard`.

`.thinkrail/extensions/git-pulse/` is a git dashboard for the active workspace: a topbar item
(`⎇ feat/x ↑2 ↓0 · 5 changed`) and a tab with recent commits, changed files, and a **Fetch** button. It
shows:

- `tr.onWatch`: a workspace is polled only while a view reads its `pulse:<workspaceId>` key, and
  dropped when the last one closes.
- `node:child_process` `execFile` running read-only `git` in the `tr.workspaces` path, plus an
  `fs.watch` on the git dir for instant refresh, closed by the returned disposer.
- An action with a slow side effect (`fetch`) whose result the view shows in place.
- A discriminated channel value (`loading`, `not-git`, `error`, `ready`) so every view handles each case.

`.thinkrail/extensions/tool-guard/` stops dangerous agent tool calls before they run. It shows:

- A **blocking** pi hook: `tr.pi` registers `pi.on("tool_call", …)`. Returning `{ block: true, reason }`
  skips the tool, and pi gives `reason` to the model as the tool's error result. Return `undefined` to
  let the call run. Every tool call waits for the handler, so keep it fast.
- Rules the user edits in a panel (`ui.Input`, toggles, remove) and keeps in `tr.store`, next to built-ins
  (`rm -rf` outside the workspace, `git push --force`, `git reset --hard`, `curl | sh`, `.env` files,
  `~/.ssh`).
- A capped decision log published on every call and saved to `tr.store` at most once a second.
- A `check` action the panel uses to try a command against the rules without running it.

`.thinkrail/extensions/test-runner/` runs the workspace's tests from a **Tests** panel or from the agent.
It shows:

- A long-running child process: `spawn` in the `tr.workspaces` path with a timeout, a **Cancel** action
  that kills the whole process group, a capped output tail, and one run per workspace.
- A structured reporter over regex: bun and vitest write JUnit to a temp file that `fast-xml-parser` reads;
  other `test` scripts fall back to bun's console summary.
- A `tr.pi` tool (`run_tests({ filter? })`) that shares state with the panel: the agent's run shows in the
  panel, a call during a panel run joins it, and `onUpdate` streams the elapsed time to its `toolCard`.
- The last result per workspace in `tr.store`, and **Fix with agent** (`startChat`) on each failure.

`.thinkrail/extensions/project-notes/` pins notes per project and adds the enabled ones to every agent run.
It shows:

- **System-prompt injection**: `tr.pi` registers `pi.on("before_agent_start", …)` and sets
  `event.systemPromptOptions.sections.project_notes`. pi wraps it in `<project_notes>` after its own
  sections. Delete the key when there is nothing to send; do not return `systemPrompt`, which replaces
  the whole prompt and every other extension's section.
- Mapping a pi session to its project: `ctx.sessionManager.getSessionId()` → `tr.sessions.list()` →
  `tr.workspaces.get(workspaceId).projectId`.
- A size cap computed by one pure function that the hook and the views share, so the panel says exactly
  which notes are sent.
- A `tr.pi` tool (`add_project_note`) for "remember that …" requests, with a `toolCard`.
- Per-project data in `tr.store`, published only while a view watches it (`tr.onWatch`), and `ui.Switch`.

`.thinkrail/extensions/ultracode/` runs dynamic workflows: the agent writes a JavaScript script that fans
work out to many subagents and returns one value. It shows:

- `tr.agents` at scale: every `agent()` call in the script is `tr.agents.spawn` with the tool's `ctx` as
  parent, a run-wide concurrency cap passed as `maxConcurrent`, and `handle.onEvent` progress (model,
  activity, pi's usage) mapped onto a live run model.
- Cancel through handles: a **Cancel** action and the tool's `signal` call `cancel()` on every live
  handle; unloading the extension cancels running workflows.
- Cost from pi only: each agent shows pi's per-run usage; the run total and the `maxCost` brake sum it.
- A `tr.pi` tool (`Ultracode`) whose `onUpdate` streams a run summary to its `toolCard`, a live `tab`
  (phases as columns, agent cards, details on click), a `panel` of runs, and a `status` item.
- Large data kept out of `tr.store`: journals for resume live under `$THINKRAIL_DATA_DIR`, the store keeps
  the 20 newest runs, capped.


`.thinkrail/extensions/themes/` changes how the app looks. It shows:

- Three `themes` in `extension.json`: a warm light theme, a high-contrast dark theme, and a soft theme
  with larger corners.
- A **Theme studio** panel: color inputs and a radius slider call `useTheme().preview` on every change,
  the three built-in themes apply with `select`, and **Copy JSON** puts a ready `themes` entry on the
  clipboard.
