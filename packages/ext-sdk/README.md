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
  default, sm, icon), `Textarea`, `Tooltip*`, `IconTooltip`, `Popover*`, `Dialog*`, `DropdownMenu*`,
  `ContextMenu*`, `Command*`.
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
