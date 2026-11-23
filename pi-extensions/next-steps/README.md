# @thinkrail/pi-next-steps

A [pi](https://pi.dev) extension that lets the agent close a finished turn with **one-click next
messages**: follow-ups you would plausibly send next ("Run the e2e suite", "Open a PR") or short
answers to a question its final message asks ("Yes, go ahead"). Press **Alt+1…9** to send one.

```bash
pi install npm:@thinkrail/pi-next-steps
```

## What you get

- **`suggest_next_steps` tool.** When its work is done, the agent calls the tool alone with a short
  list of suggestions, then writes its final message as the last thing in the turn. Newer Claude models
  return text written right before a tool call as a short server-side summary, so the answer comes
  after the call, where it always arrives in full. If the agent already wrote its answer as text before
  the call, the turn simply ends. When nothing useful applies, the agent skips the call and you see
  nothing.
- **A row above the editor.** After the turn settles, the suggestions appear above pi's input with their
  keys:

  ```
   ⌥1 Run the e2e suite   ⌥2 Add a regression test   ⌥3 Open a PR
  ```

  **Alt+1…9** sends that suggestion as your next message. The row clears when the next run starts, and
  comes back when you resume a session (or move in the tree) to a point that ended with suggestions.
- **Transcript rendering.** The call shows as "Suggested N next steps" with the numbered list.
- **Readable everywhere.** In `pi -p`, JSON/RPC mode or any host without a terminal, the suggestions are
  in the tool result's `details.suggestions`; the row and shortcuts are terminal-only. GUI hosts can draw
  their own buttons from that result. [ThinkRail](https://thinkrail.ai/?utm_source=pi-package&utm_medium=referral&utm_campaign=pi-next-steps&utm_content=readme-hosts)
  shows them as chips above its composer.

### macOS terminals

Alt+digit reaches pi only when the terminal sends Option as Meta (otherwise Option+1 types `¡`):

- **Terminal:** Settings → Profiles → Keyboard → *Use Option as Meta key*.
- **iTerm2:** Settings → Profiles → Keys → *Left Option key: Esc+*.
- **Ghostty:** `macos-option-as-alt = true`.

### Linux terminals

GNOME Terminal switches tabs with Alt+1…9 by default, so pi never sees them; rebind or clear *Switch
to Tab 1…9* in Preferences → Shortcuts.

## Cost

Each turn that offers suggestions spends roughly 50–100 extra output tokens, one more model request
when the final message comes after the tool result, plus the tool's short prompt text in every request.

## For hosts

`@thinkrail/pi-next-steps/core` is import-free at runtime and exports the tool name, the result type,
`normalizeSuggestions` and `suggestionsOnBranch(entries)`, the rule for "this session currently ends with
suggestions" (the final text message after the call and bookkeeping entries such as model or
thinking-level changes are skipped). The tool ends the turn only when the calling message already holds a text answer. Version 0.1.0 could refuse a
call with `details: { suggestions: [], refused: true }`; sessions recorded then may still hold one. The row is drawn
only in pi's interactive terminal mode (`ctx.mode === "tui"`), so a host binding pi in RPC mode never
shows it twice. To add your own rules, compose `createNextStepsExtension({ guidance: { promptGuidelines:
[...DEFAULT_PROMPT_GUIDELINES, "…"] } })`; `guidance` replaces only the `description`, `promptSnippet` or
`promptGuidelines` you pass.

## Requirements

pi ≥ the version listed under `devDependencies` in this package's `package.json` (the pi SDK packages
are peer dependencies supplied by your pi install). Works under Node (vanilla pi) and Bun.

## License

Apache-2.0 — part of [ThinkRail](https://thinkrail.ai/?utm_source=pi-package&utm_medium=referral&utm_campaign=pi-next-steps&utm_content=readme).
