/**
 * Per-tool header extraction registry.
 *
 * Each extractor knows which fields matter for a given tool and produces
 * a compact summary + optional badge for the collapsed ToolCallCard header.
 */

export interface ToolHeaderInfo {
  /** Main text shown in collapsed header (e.g. "ls -la src/") */
  summary: string;
  /** Optional right-side metadata (e.g. "4 lines", "3 files") */
  badge?: string;
}

type HeaderExtractor = (
  input: Record<string, unknown>,
  output?: string,
  isError?: boolean,
) => ToolHeaderInfo;

// ── Helpers ──

function truncate(s: string, max = 100): string {
  return s.length > max ? s.slice(0, max) + "\u2026" : s;
}

function countLines(text?: string): number {
  if (!text) return 0;
  // Trim trailing newline so "a\nb\n" counts as 2, not 3
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n").length;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ── Extractors ──

const bashExtractor: HeaderExtractor = (input, output) => {
  const cmd = str(input.command);
  return {
    summary: truncate(cmd),
    badge: output ? `${countLines(output)} lines` : undefined,
  };
};

const readExtractor: HeaderExtractor = (input, output) => {
  const filePath = str(input.file_path);
  const offset = input.offset as number | undefined;
  const limit = input.limit as number | undefined;
  let summary = truncate(filePath, 80);
  if (offset != null || limit != null) {
    const from = (offset ?? 0) + 1;
    const to = limit != null ? from + limit - 1 : undefined;
    summary += to != null ? ` lines ${from}\u2013${to}` : ` from line ${from}`;
  }
  return {
    summary,
    badge: output ? `${countLines(output)} lines` : undefined,
  };
};

const grepExtractor: HeaderExtractor = (input, output) => {
  const pattern = str(input.pattern);
  const path = str(input.path);
  let summary = `/${pattern}/`;
  if (path) summary += ` in ${truncate(path, 40)}`;
  const lines = output ? countLines(output) : 0;
  return {
    summary: truncate(summary),
    badge: lines > 0 ? `${lines} results` : undefined,
  };
};

const globExtractor: HeaderExtractor = (input, output) => {
  const pattern = str(input.pattern);
  const path = str(input.path);
  let summary = pattern;
  if (path) summary += ` in ${truncate(path, 40)}`;
  const lines = output ? countLines(output) : 0;
  return {
    summary: truncate(summary),
    badge: lines > 0 ? `${lines} files` : undefined,
  };
};

const agentExtractor: HeaderExtractor = (input) => {
  const type = str(input.subagent_type);
  const desc = str(input.description);
  const parts = [type, desc].filter(Boolean);
  return { summary: truncate(parts.join(" \u2014 ")) };
};

const webSearchExtractor: HeaderExtractor = (input) => ({
  summary: truncate(str(input.query)),
});

const webFetchExtractor: HeaderExtractor = (input) => ({
  summary: truncate(str(input.url), 80),
});

const askUserExtractor: HeaderExtractor = (input) => {
  const questions = input.questions as Array<Record<string, unknown>> | undefined;
  const first = questions?.[0];
  const q = first ? str(first.question) : "";
  return { summary: truncate(q) };
};

// ── Registry ──

const EXTRACTORS: Record<string, HeaderExtractor> = {
  Bash: bashExtractor,
  Read: readExtractor,
  Grep: grepExtractor,
  Glob: globExtractor,
  Agent: agentExtractor,
  WebSearch: webSearchExtractor,
  WebFetch: webFetchExtractor,
  AskUserQuestion: askUserExtractor,
};

/** Fallback: pick the first string-valued field from input. */
function fallbackExtractor(input: Record<string, unknown>): ToolHeaderInfo {
  for (const v of Object.values(input)) {
    if (typeof v === "string" && v.length > 0) {
      return { summary: truncate(v) };
    }
  }
  const json = JSON.stringify(input);
  return { summary: truncate(json, 60) };
}

/**
 * Strip the `mcp__servername__` prefix from MCP tool names for display.
 *
 * E.g. `mcp__thinkrail-specs__registry_query` → `registry_query`
 */
export function cleanToolName(name: string): string {
  const m = name.match(/^mcp__[^_]+__(.+)$/);
  return m ? m[1] : name;
}

/**
 * Extract a smart header summary + badge for a tool call.
 *
 * Uses per-tool extractors when available, falls back to picking the
 * first string field from the input object.
 */
export function extractToolHeader(
  toolName: string,
  input: Record<string, unknown>,
  output?: string,
  isError?: boolean,
): ToolHeaderInfo {
  const extractor = EXTRACTORS[toolName];
  if (extractor) return extractor(input, output, isError);
  return fallbackExtractor(input);
}
