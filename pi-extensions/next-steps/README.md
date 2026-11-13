# @thinkrail/pi-next-steps

A [pi](https://pi.dev) extension that lets the agent end a finished turn with **one-click next
messages**: follow-ups you would plausibly send next ("Run the e2e suite", "Open a PR") or short
answers to a question its last message asked ("Yes, go ahead"). Press **Alt+1…9** to send one.

```bash
pi install npm:@thinkrail/pi-next-steps
```

## What you get

- **`suggest_next_steps` tool.** When its work is done, the agent writes its final message, then calls
  the tool alone with a short list of suggestions. The tool ends the turn, so there is no extra model
  round trip. When nothing useful applies, the agent skips the call and you see nothing.
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

## Cost

Each turn that offers suggestions spends roughly 50–100 extra output tokens, plus the tool's short
prompt text in every request.

## For hosts

`@thinkrail/pi-next-steps/core` is import-free at runtime and exports the tool name, the result type,
`normalizeSuggestions` and `suggestionsOnBranch(entries)`, the rule for "this session currently ends with
suggestions" (bookkeeping entries such as model or thinking-level changes are skipped). The row is drawn only in pi's interactive terminal mode (`ctx.mode === "tui"`), so a host
binding pi in RPC mode never shows it twice.

## Requirements

pi ≥ the version listed under `devDependencies` in this package's `package.json` (the pi SDK packages
are peer dependencies supplied by your pi install). Works under Node (vanilla pi) and Bun.

## License

Apache-2.0 — part of [ThinkRail](https://thinkrail.ai/?utm_source=pi-package&utm_medium=referral&utm_campaign=pi-next-steps&utm_content=readme).
