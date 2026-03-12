# Console — Sub-Specification

> Parent: [Frontend Module](../../../README.md) | Status: **Active** | Created: 2026-03-02

## Overview

The Console is a right-panel tab providing multiple terminal emulator instances via xterm.js. It's independent of agent sessions — for running manual commands, viewing logs, and interacting with the local shell.

## Component Hierarchy

```
<ConsoleView>                        // right-panel tab content
  <ConsoleTabBar>                    // terminal instance tabs
    <ConsoleTab /> ...               // one per terminal
    <ConsoleTabAdd />                // "+" button
  </ConsoleTabBar>
  <TerminalContainer>                // xterm.js mount point
    <XTermInstance />                // active terminal
  </TerminalContainer>
</ConsoleView>
```

## Terminal Library

**xterm.js** — the standard browser terminal emulator.

| Dependency | Version | Purpose |
| --- | --- | --- |
| `@xterm/xterm` | latest | Core terminal emulator |
| `@xterm/addon-fit` | latest | Auto-resize to container |
| `@xterm/addon-web-links` | latest | Clickable URLs |
| `@xterm/addon-search` | latest | Ctrl+F search within output |

## Terminal Tabs

```
┌─ Terminal 1 ─┬─ Terminal 2 ─┬─ + ─┐
```

- Each tab is an independent terminal instance with its own shell process
- Default: one terminal created on first Console tab activation
- `+` button creates a new terminal
- Tabs show name (default: "Terminal N") — double-click to rename
- Close button (`✕`) on each tab — kills the shell process
- Max terminals: 5 (configurable)

## Terminal Configuration

| Setting | Default | Description |
| --- | --- | --- |
| Shell | User's default (`$SHELL`) | Shell executable |
| CWD | Project root | Initial working directory |
| Font family | `--font` (SF Mono, Monaco, etc.) | Matches the app's monospace font |
| Font size | 13px | Matches app font size |
| Theme | Matches app theme colors | See color mapping below |
| Scrollback | 5000 lines | Lines kept in buffer |

## Theme Color Mapping

xterm.js theme mapped to Bonsai CSS variables:

```typescript
const xtermTheme = {
  background: '#0a0e1a',    // --bg
  foreground: '#c0caf5',    // --text
  cursor: '#7aa2f7',        // --blue
  cursorAccent: '#0a0e1a',  // --bg
  selectionBackground: '#364a82',  // --sel
  black: '#414868',         // --border
  red: '#f7768e',           // --red
  green: '#9ece6a',         // --green
  yellow: '#e0af68',        // --gold
  blue: '#7aa2f7',          // --blue
  magenta: '#bb9af7',       // --purple
  cyan: '#7dcfff',          // --cyan
  white: '#c0caf5',         // --text
};
```

## Backend Integration

Terminals connect to the backend via a WebSocket endpoint (separate from the JSON-RPC `/ws`):

| Endpoint | Method | Description |
| --- | --- | --- |
| `/terminal/create` | POST | Create a new terminal process, returns `terminalId` |
| `/terminal/{id}/ws` | WebSocket | Bidirectional data stream (stdin/stdout) |
| `/terminal/{id}/resize` | POST | Send new dimensions `{ cols, rows }` |
| `/terminal/{id}/kill` | POST | Kill the terminal process |

**Note:** These terminal endpoints are a new addition to the backend, not part of the current RPC module. They should be implemented as a separate FastAPI router using `pty` (Unix pseudo-terminal) for shell process management.

## Resize Handling

- xterm.js `addon-fit` auto-fits terminal to container size
- On right panel resize → debounce 100ms → `fit()` → send new dimensions to backend
- On terminal tab switch → `fit()` on the now-visible terminal

## Keyboard Shortcuts

> **Modifier key:** Mod = Ctrl on macOS, Alt on Linux/Windows

| Key | Action | Scope |
| --- | --- | --- |
| `Mod+\`` | Focus console tab (global) | Switches right panel to Console |
| `Ctrl+Shift+T` | New terminal | Within Console |
| `Ctrl+Shift+W` | Close current terminal | Within Console |
| `Ctrl+Shift+[` / `]` | Switch terminal tabs | Within Console |
| `Ctrl+F` | Search within terminal | Within Console |

**Note:** Standard terminal shortcuts (Ctrl+C, Ctrl+D, etc.) pass through to the shell.

## State

```typescript
interface ConsoleState {
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
}

interface TerminalInfo {
  id: string;
  name: string;
  backendId: string;       // backend terminal process ID
  xtermInstance: Terminal;  // xterm.js instance (not serializable)
  wsConnection: WebSocket; // data stream connection
}
```

## Lifecycle

1. **First activation:** User clicks Console tab → create first terminal → connect WebSocket → mount xterm.js
2. **Tab switch:** Store xterm.js instances in memory, swap which one is mounted in the DOM
3. **Panel hidden:** Terminals keep running in background (WebSocket stays open)
4. **Close tab:** Send kill command → close WebSocket → dispose xterm.js instance
5. **App close:** All terminal processes killed by backend on WebSocket disconnect

## CSS Classes

| Class | Element |
| --- | --- |
| `.console-view` | Container |
| `.console-tabs` | Tab bar |
| `.console-tab` | Individual tab |
| `.console-tab.on` | Active tab |
| `.console-tab-add` | New terminal button |
| `.console-terminal` | xterm.js mount container |

## Known Limitations

- **Requires backend terminal endpoints:** The /terminal/* endpoints are a new backend addition not yet implemented
- **No terminal session persistence:** Terminal state lost if the Console tab is closed (shell process killed)
- **No shared terminal with agent:** Agent sessions run in their own processes — Console terminals are independent

## Related Specs

- **Parent:** [Frontend Module](../../../README.md)
- **Depends on:** [Web View](../../../ui-specs/WEBVIEW.md) §4.5 (UI spec), [Theming](../../../ui-specs/THEMING.md) (xterm color mapping)
- **Related:** [App Shell](../../../ui-specs/APP_SHELL.md) (right panel tab)
