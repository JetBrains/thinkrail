How to ask an agent for a visual change to ThinkRail so you see the result quickly, without wasting
tokens or time. The generated `DESIGN.md` at the repository root carries this prompt together with the
current foundations (themes, fonts, spacing, radius, components), so give an agent that file rather than
an old copy.

## 0. Know the product

ThinkRail is the agentic IDE built around the `pi` coding agent: a rich interface around the agent, work
isolated into separate workspaces, and durable project knowledge through living specs and reusable
skills. The UI is a dense work surface — projects and workspaces, conversations with tool steps, diffs,
files, specs and terminals side by side — so a visual change has to stay legible next to code and long
conversations, in every bundled theme.

## 1. Limit the scope

- Frontend only, no backend / wire / contract changes unless the task explicitly requires it.
- Use mocked data where needed — don't stand up real data sources.
- Keep the change minimal — touch only what's needed for the visual result.

> Frontend-only. No backend / wire / contract changes. Use mocked data where needed. Keep the change
> minimal — touch only what's needed for the visual result.

## 2. One commit per change

Ask for each logical change to be committed on its own, so the last change can be reverted independently.

> Commit this change on its own, separate from any previous changes, so it can be reverted independently.

## 3. Be specific about the element

- What the element is, where it is now, how it looks, how it should look.
- If it moves — from where to where.
- If it is about style — name the token or component variant, not a raw value: a colour role
  (`text-muted`, `control-primary-bg`), a type style (`tr-text-ui`), a spacing step (`gap-8`), a radius
  step (`rounded-md`), a button variant and size. Look them up in this library's Foundations and
  Components pages.

## 4. Respect the design system unless you are changing it on purpose

- Use the existing components and their props (see [Using the library](#/using)).
- If the task is not about the design system itself, don't touch the token files.
- If it is, change the value at its source (`colors.json`, a theme manifest, `typography.json`,
  `spacing.json`, `tokens.css`) and let the generated CSS and this library follow.

## 5. Account for architectural behaviour

- Closing a tab is not ending the agent session.
- Domain state (projects, workspaces, sessions) lives on the server; view state (open tabs, drafts,
  panel sizes) lives only in the client.
- Don't break hydrate-then-stream: the client is a projection of state, not a second source of truth.

## Prompt skeleton

```text
[What to change — the specific element, from/to, which token or component variant]

Frontend-only. No backend / wire / contract changes. Use mocked data where needed.
Keep the change minimal — touch only what's needed for the visual result.
Commit this change on its own so it can be reverted independently.
Use the existing ThinkRail components and tokens (see DESIGN.md); don't change token values unless that
is the task.
```
