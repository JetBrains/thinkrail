# The web half

`web/index.tsx` default-exports a `defineWebExtension` descriptor. `thinkrail-extension build` bundles it
into one ESM file (`dist/web.js`) and its styles into `dist/web.css`; the app loads both when the
extension is installed. A card is drawn for a tool call whose tool name is a key of `toolRenderers` —
the tool may come from this extension's server half, another extension, a pi package or an MCP server
(MCP tools are named `mcp__<server>__<tool>`).

```tsx
export default defineWebExtension({
	name: "thinkrail-ext-<slug>",          // the package name
	toolRenderers: {
		my_tool: {
			renderer: MyCard,               // (props: ToolRenderProps) => ReactNode
			options: {
				summary: (props) => "one line for the collapsed row",
				prominence: "primary",      // "primary" = a card; "routine" = a row in the activity group
				defaultExpanded: true,
				chrome: "card",             // or "bare": no frame around the card
				interactive: false,         // true for an interactive tool
			},
		},
	},
});
```

`ToolRenderProps`: `toolCallId`, `toolName`, `args` (the call's arguments), `result` (`undefined` while
running, else `{ content, details }` — read your own `details`), `status` (`"running" | "done" |
"error"`), `streaming`, `workspaceRoot?`, `onOpenFile?(path)`, `interaction?` (interactive tools).
Always handle the running and error states. A card that throws falls back to the default row.

## What a web half may import

Shared with the app at runtime — never bundled, never installed separately:

- `react`, `react/jsx-runtime`, `react-dom` (React 19; `createPortal` is fine);
- `@thinkrail/extension-sdk/web` — `defineWebExtension`, the types, and helpers `strArg(args, key)`
  (a string, `""` when missing), `numArg(args, key)` (a number or `null`), `resultText(result)` (the
  result's text), `parseToolResultContent`, `toolValueText`, `languageFromPath`;
- `@thinkrail/extension-sdk/ui/button` (`Button`, `IconButton`), `…/ui/dialog`, `…/ui/textarea`,
  `…/ui/attention-line`, `…/ui/keyboard`, `…/ui/utils` (`cn`), `…/ui/theme`, `…/ui/fonts`;
- `@thinkrail/extension-sdk/resources` — `ResourcePreview`, `FramedResourcePreview`,
  `useResourceScope`, `useOptionalResourceHost`.

Anything else (an icon set such as `@remixicon/react`, a chart library) is bundled into `dist/web.js`:
`npm install --omit=peer <pkg>` it first. Keep it small.

## Styles

- Write every Tailwind utility with the prefix passed to `--prefix`: `wordcount:flex`,
  `wordcount:gap-8`, `wordcount:text-text-muted`. Unprefixed utilities are not generated (and an
  unprefixed sheet would reorder the app's own utilities). The prefix also works with variants:
  `wordcount:hover:bg-control-bg-hovered`.
- The app's typography classes are used **without** a prefix: `tr-text-ui`, `tr-text-metadata`,
  `tr-text-caption`, `tr-text-emphasis`, `tr-heading-sm`, `tr-heading-md`, `tr-code-text`,
  `tr-code-text-small`.
- Use the app's colour tokens so light and dark themes work: text `text-text-default`, `text-text-muted`,
  `text-text-subtle`; surfaces `bg-sunken`, `bg-container-elevated-bg`, `bg-control-bg`; borders
  `border-border-default`, `border-border-muted`; status `text-feedback-error`, `bg-feedback-info-subtle`,
  `bg-feedback-success-subtle`, `bg-feedback-warning-subtle`; accent `bg-primary`, `text-primary`.
  Never raw hex colours or inline `style` colours.
- Spacing utilities are pixels (`p-8` = 8px); prefer 2, 4, 8, 12, 16, 24, 32. Radii: `rounded-sm`,
  `rounded-md`, `rounded-lg`.
- Your own CSS goes in a file passed with `--css <file>`, never imported from JavaScript.

## Rules the build enforces

- No React Compiler, no `react-dom/client` (the app owns the React root), no other `react` /
  `react-dom` subpath.
- No CSS imported from JavaScript.
- No `@thinkrail/ui`, `@thinkrail/extension-api` or other private ThinkRail packages; no
  `@thinkrail/extension-sdk/server` in the web half.
- Text is the extension's own, in plain strings. The `t` passed to `summary` is the app's translator
  for the app's own keys — do not use it.

## Build errors

The build prints `thinkrail-extension: <problem> (imported by <file>)` and exits non-zero:

| Message starts with | Fix |
|---|---|
| `react-dom/client is owned by ThinkRail` | render through the card; no own root |
| `<file>.css: a web half cannot import CSS` | remove the import; pass `--css <file>` |
| `react/compiler-runtime is not shared` | build without the React Compiler |
| `@thinkrail/ui/… is private` | import the `@thinkrail/extension-sdk/ui/…` it names |
| `… belongs to the server half` | move that code to `server/` |
| `package.json has an invalid "thinkrail" manifest` | fix the listed manifest rule (SKILL.md § 4) |
| `"api" is "X", but this @thinkrail/extension-sdk builds extension API Y` | set `api` to Y (or install the SDK for X) |
| `--prefix is required` / `--prefix "…" is invalid` | pass `--prefix` with lowercase a–z only |

A `warning: [UNRESOLVED_IMPORT] Could not resolve '<pkg>'` does **not** fail the build but leaves a
bare `import` in `dist/web.js` that fails in the app: `npm install --omit=peer <pkg>` (or remove the import) and
rebuild. A clean `dist/web.js` never starts with `import`.
