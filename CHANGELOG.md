# Changelog

## Unreleased

### Added

- Expanded optional read-only Vim mode in desktop Monaco source editors toward `vim.tiny` navigation parity.
  - Toggle with the visible `Vim` control or the command palette's **Toggle Vim mode** command.
  - Supports `Normal`, `Insert`, and `Visual` modes, including character, line, and block selection.
  - Supports core motions, marks, jump history, viewport commands, `/` and `?` searches, `n`, `Shift+N`, `*`, `#`, and repeat counts such as `10j`.
  - Mutation commands, registers, clipboard, Ex commands, undo, and file saves remain unavailable because the editor is read-only.
