import { execFileSync } from 'node:child_process';

/**
 * Import the user's login-shell environment into `process.env`.
 *
 * Why: when the packaged app is launched from Finder/dock on macOS (or from
 * a desktop launcher on Linux), launchd / the desktop session starts the
 * process with a stripped env — no shell PATH, no `ANTHROPIC_API_KEY`, none
 * of the exports from `~/.zshrc` / `~/.bash_profile` / `~/.config/fish/`.
 * Spawn the user's interactive login shell once, capture its env, and merge
 * any keys we don't already have. This is the same pattern used by VS Code,
 * Hyper, GitHub Desktop, and the `shell-env` npm package.
 *
 * Supported shells (interactive + login + `-c` form): bash, zsh, fish, dash,
 * ksh, sh. Exotic shells (tcsh/csh, nushell, powershell on \*nix) fall
 * through silently — the existing dotenv fallback in `credentials.ts` still
 * applies.
 */
const MARKER = '__BONSAI_SHELL_ENV__';
const TIMEOUT_MS = 5_000;

export function importShellEnv(): void {
  if (process.platform === 'win32') return;
  if (process.env.BONSAI_NO_SHELL_ENV === '1') return;
  // Already terminal-launched: process.env is already complete. TERM_PROGRAM
  // is set by Terminal.app / iTerm2 / VS Code. We deliberately do NOT key on
  // `_` — launchd's helper sets it on Finder/dock launches too, so checking
  // it would skip the import on exactly the launches that need it.
  if (process.env.TERM_PROGRAM) return;

  const shellPath = process.env.SHELL || '/bin/zsh';
  const captured = captureShellEnv(shellPath);
  if (!captured) return;

  for (const [key, value] of Object.entries(captured)) {
    // Don't overwrite anything launchd / Electron / the user already set —
    // those are authoritative (HOME, USER, TMPDIR, XPC_*, ELECTRON_*, the
    // overrides BONSAI_BACKEND_DIR / BONSAI_DATA_DIR set by tests, etc.).
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function captureShellEnv(shellPath: string): Record<string, string> | null {
  // -i sources rc files (.zshrc, .bashrc, fish's config.fish), -l sources
  // login profile (.zprofile, .bash_profile, .fish_profile). Most exports
  // people care about live in -i files; some live in -l files. We pass
  // both for broadest coverage.
  //
  // The marker brackets the env output so we can ignore noise that rc
  // files print to stdout (e.g. Powerlevel10k instant prompt, fish
  // greeting). `env` (POSIX /usr/bin/env) prints KEY=VALUE one per line,
  // and works identically across bash/zsh/fish because it's an external
  // binary, not a shell builtin. Multi-line env values (extremely rare —
  // newlines in PATH/API keys don't happen in practice) would break this
  // line-based parse; that's an accepted limitation.
  const cmd = `echo ${MARKER}; env; echo ${MARKER}`;

  let raw: string;
  try {
    raw = execFileSync(shellPath, ['-ilc', cmd], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return null;
  }

  const start = raw.indexOf(MARKER);
  const end = raw.lastIndexOf(MARKER);
  if (start === -1 || end <= start) return null;
  const body = raw.slice(start + MARKER.length, end);

  const result: Record<string, string> = {};
  for (const line of body.split('\n')) {
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    result[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return Object.keys(result).length > 0 ? result : null;
}
