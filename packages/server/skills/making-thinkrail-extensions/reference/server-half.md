# The server half

`server/index.ts` is TypeScript source; ThinkRail loads it in place through pi's extension loader (no
compile step), with **ThinkRail's own** `@earendil-works/pi-coding-agent` and `typebox` — whatever is or
is not in the folder's `node_modules`. Import SDK types with `import type`; they disappear when the
host loads the source. Other runtime libraries resolve from the folder's `node_modules`, so add them
to `dependencies` with `npm install --omit=peer <pkg>`. Relative imports of other `.ts` files work.

## The descriptor

```ts
import type { ServerExtension } from "@thinkrail/extension-sdk/server";

export default {
	name: "thinkrail-ext-<slug>",        // exactly the package.json name, else the extension fails
	title: "…",                          // Settings copy (the manifest `title` wins when both exist)
	description: "…",
	extensions: [/* pi ExtensionFactory, run for every chat */],
	sessionExtensions: (session) => [/* factories built per chat, may read settings */],
	settings: { key: { type: "boolean", default: true, title: "…", description: "…" } },
	interactiveTools: { tool_name: { describeResponse: (args, response) => "…" } },
	skillPackages: [".."],
} satisfies ServerExtension;
```

Only `name` and `extensions` are required. Import `ServerExtension` and
`ExtensionSessionServices` as types from `@thinkrail/extension-sdk/server`; import `ExtensionAPI` as a
type from `@earendil-works/pi-coding-agent`. Keep the SDK in `devDependencies` so installed extensions
do not carry its build toolchain.

## Tools

A factory is `(pi: ExtensionAPI) => void`. Register tools with pi's `registerTool`:

```ts
pi.registerTool({
	name: "my_tool",
	label: "My tool",
	description: "What it does and when to use it — the model reads this.",
	promptSnippet: "One line for the system prompt's tool list.",
	parameters: Type.Object({ query: Type.String({ description: "…" }) }),
	async execute(toolCallId, params, signal) {
		return { content: [{ type: "text", text: "what the model reads" }], details: { /* the card's data */ } };
	},
});
```

- `parameters` is a typebox schema (`import { Type } from "typebox"`): `Type.Object`, `Type.String`,
  `Type.Number`, `Type.Boolean`, `Type.Array`, `Type.Optional(…)`; for a string enum use
  `Type.Unsafe<"a" | "b">({ type: "string", enum: ["a", "b"] })`.
- Throw from `execute` to report an error to the model; honour `signal` in long work.
- Tools run on the user's machine with the host's permissions. Keep network calls and file writes to
  what the user asked for.
- A tool name a built-in or an earlier-listed extension already registers stays theirs.

## Settings

Boolean only. Declare them in `settings` with a `title` and `description` (shown in Settings →
Extensions; there are no translations). Read a value with `session.setting("key")` inside a factory
returned by `sessionExtensions` — that runs when a chat builds its tools, so a changed setting reaches a
chat after its current turn. Reading an undeclared key throws, which leaves the extension loaded with no
tools (the status file's `tools` is then empty).

## Interactive tools

A tool whose call waits for the person to answer in its card:

- server: list it in `interactiveTools`; in `execute`, call `session.expectToolResponse(toolCallId)` then
  `const response = await session.awaitToolResponse(toolCallId, signal)`. `response.kind` is
  `"response"` (`response.value` is what the card sent), `"deferred"` (the person moved on before
  answering; return a result saying so — a later answer reaches the model through `describeResponse`)
  or `"abandoned"` (the call was cancelled).
- web: register the card with `options: { interactive: true }` and call
  `props.interaction?.respond(value)`; `props.interaction.state` says whether it still accepts input.

## Skills

Put skills in the package (`skills/<skill-name>/SKILL.md`, with `name` and `description` frontmatter),
add `"pi": { "skills": ["./skills"] }` to `package.json`, and `skillPackages: [".."]` to the descriptor
(the path from the `server` file's folder to the package root). They load in every chat and switch off
with the extension.

## Trying logic before installing

`server/index.ts` cannot run outside ThinkRail (pi and typebox are not in the folder). Keep the tool's
pure logic in its own file with no pi or typebox imports, and try it with Node, which strips types:
`node -e 'import("./server/dice.ts").then((m) => console.log(m.roll("2d6+3")))'`.

## What not to do

- Never list `@earendil-works/*` or `typebox` under `dependencies`; keep them as `peerDependencies` and
  install with `npm install --omit=peer` (a plain `npm install` pulls ~190 MB of pi into the folder).
- Do not import ThinkRail internals (`@thinkrail/server`, `@thinkrail/ui`, …); only
  `@thinkrail/extension-sdk/*` is public.
- Do not keep state you need across chats in module variables: a reload re-imports the module.
