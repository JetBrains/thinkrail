import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve an Anthropic API key for the spawned backend.
 *
 * The shell-env import in `shellEnv.ts` populates `process.env` from the
 * user's interactive login shell at startup, so a Finder/dock-launched
 * Electron process sees `ANTHROPIC_API_KEY` if the user exported it from
 * `.zshrc` / `.bash_profile` / `~/.config/fish/config.fish` — the same
 * way Zenflow, VS Code, etc. work invisibly.
 *
 * This file is the explicit per-app fallback for users whose key isn't in
 * a shell rc (or who use a shell we can't import: tcsh, nushell, ...).
 *
 * Resolution order:
 *   1. `ANTHROPIC_API_KEY` env var — set by the shell, by `npm run dev`,
 *      or imported by `shellEnv.ts` from the user's login shell.
 *   2. `<dataDir>/.env` line `ANTHROPIC_API_KEY=...` where `<dataDir>` is
 *      `BONSAI_DATA_DIR` if set, else `~/.bonsai`. Documented user-
 *      controlled fallback for any platform / shell.
 *
 * Returns null if no key is found.
 */
export function resolveAnthropicApiKey(): string | null {
  const fromEnv = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (fromEnv) return fromEnv;

  return readDotenvKey();
}

function dataDirRoot(): string {
  const override = (process.env.BONSAI_DATA_DIR ?? '').trim();
  return override || join(homedir(), '.bonsai');
}

function readDotenvKey(): string | null {
  const path = join(dataDirRoot(), '.env');
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  // Match `ANTHROPIC_API_KEY=<value>` with optional surrounding whitespace
  // and optional single/double quotes around the value.
  const match = contents.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/m);
  if (!match) return null;
  const raw = match[1].trim();
  const unquoted = raw.replace(/^["'](.*)["']$/, '$1');
  return unquoted || null;
}
