# Writing a ThinkRail UI extension

An extension adds UI to ThinkRail: a panel, a document tab, a topbar item, a card for a tool call, or a
card for a custom chat message. It is a directory of TypeScript that the host builds and loads hot. It runs
in-process with full rights, like a pi extension.

## Where it lives

- `~/.thinkrail/extensions/<name>/` (user; `$THINKRAIL_DATA_DIR/extensions` when that is set). Loads always.
- `<project>/.thinkrail/extensions/<name>/`. Loads only after the user trusts the project.

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
  `compaction_end`, `agent_settled`. A run is finished at `agent_settled`, never `agent_end` (retries and
  compaction may follow `agent_end`). `session` is `{ sessionId, workspaceId, title, isStreaming }`.
- `tr.publish(key, value)`: push a value to views. The host keeps the last value; a view mounted later
  gets it. Values must be JSON.
- `tr.action(id, (payload, ctx) => result)`: a function views can call. `ctx` has `projectId`,
  `workspaceId`, `sessionId` of the calling view.
- `tr.store.get(key)` / `tr.store.set(key, value)`: JSON that survives reloads and restarts.
- `tr.sessions.list()`, `tr.sessions.stats(sessionId)`: live sessions and pi's own stats (tokens, cost,
  context use). Never compute cost yourself.
- `tr.every(ms, fn)`: interval timer.
- `tr.pi((pi) => { … })`: a pi extension factory added to every top-level chat session (`pi.registerTool`,
  `pi.on("tool_call", …)`, `pi.sendMessage({ customType, content, display: true, details })` …). Sessions
  pick up a change after their current run settles.
- Return a disposer function to close your own resources (sockets, watchers) on unload.

Rules: the factory runs again on every reload, so do no side effects outside `tr.*` and the returned
disposer. Keep state in closures or `tr.store`. Do not write files into the extension directory: a change
there triggers a reload. Imports available without install: `@thinkrail/ext`, `typebox`,
`@earendil-works/pi-coding-agent`, Node/Bun built-ins.

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
- `openSurface(ext, surfaceId, params?)`: open a `tab`/`panel` surface; it receives `params`.
- `SurfaceProps`: `{ surfaceId, host, params?, toolCall?, message? }`. A `toolCard` view gets
  `toolCall = { toolCallId, toolName, args, result, status }`; a `message` view gets
  `message = { customType, text, details, timestamp }`.
- `ui`: the app's own components: `Button` (`variant`: default, destructive, outline, ghost; `size`:
  default, sm, icon), `Textarea`, `Tooltip*`, `IconTooltip`, `Popover*`, `Dialog*`, `DropdownMenu*`,
  `ContextMenu*`, `Command*`.
- `cn(...classes)`, `remixicon` (all `@remixicon/react` icons: `Ri…Line`, `Ri…Fill`).
- `react`, `react-dom`, `react/jsx-runtime` resolve to the app's React. Other npm deps: add them to the
  extension's own `package.json` and `bun install`; they are bundled into the view.

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

No raw hex, no inline `style` objects for colour, no Tailwind palette names (`bg-blue-500`): they do not
follow the theme. An unknown utility renders unstyled without an error.

## Dev loop

1. Write the files.
2. `ext_validate(name)`: checks the manifest, builds every view, and dry-runs `index.ts` without touching
   the running version. Fix every error it lists.
3. `ext_reload(name)`: validates, then loads it as the running version (a new extension loads too). Open
   surfaces swap in place. If it fails, the old version keeps running.
4. `ext_logs(name, since?)`: `tr.log` output, load and build errors, and errors from views crashing in the
   browser. Each line carries its time in ms; pass it as `since` to see only newer entries.

The host also reloads an extension shortly after its files change. Use `ext_reload` anyway to get the
result. A view that crashes shows its error in place with an "Ask agent to fix" button.
