import type { ReactNode } from "react";
import { useState, useMemo } from "react";

interface ToolOutputBodyProps {
  output: string;
  isError?: boolean;
}

/** Lines shown before truncation. */
const TRUNCATE_AFTER = 15;
/** Threshold: outputs longer than this get truncated. */
const TRUNCATE_THRESHOLD = 30;

/**
 * Try to parse the output as JSON. Returns the parsed object if successful,
 * or null if it's not valid JSON or is a primitive.
 */
function tryParseJson(text: string): object | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Colorize a pretty-printed JSON string with span wrappers.
 *
 * Uses simple regex matching on the already-formatted output from
 * JSON.stringify. No external syntax highlighting library needed.
 */
function colorizeJson(json: string): (string | ReactNode)[] {
  // Split approach: build an array of spans
  const parts: (string | ReactNode)[] = [];
  let lastIndex = 0;
  let keyIdx = 0;

  // First pass: colorize keys
  const withKeys = json.replace(/("(?:[^"\\]|\\.)*")\s*:/g, (_m, key: string) => {
    return `\x00KEY${key}\x00ENDKEY:`;
  });

  // Second pass: colorize values after colons
  const withValues = withKeys.replace(
    /:\s*("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (_m, val: string) => {
      if (val === "true" || val === "false" || val === "null") {
        return `: \x00BOOL${val}\x00ENDBOOL`;
      }
      if (val.startsWith('"')) {
        return `: \x00STR${val}\x00ENDSTR`;
      }
      return `: \x00NUM${val}\x00ENDNUM`;
    },
  );

  // Parse markers into JSX elements. \x00 is used as a deliberate field
  // separator that cannot appear in user content, so we skip the lint rule.
  // eslint-disable-next-line no-control-regex
  const MARKER_RE = /\x00(KEY|STR|NUM|BOOL)(.*?)\x00END\1/g;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(withValues)) !== null) {
    if (m.index > lastIndex) {
      parts.push(withValues.slice(lastIndex, m.index));
    }
    const type = m[1];
    const text = m[2];
    const cls =
      type === "KEY" ? "json-key"
        : type === "STR" ? "json-string"
          : type === "NUM" ? "json-number"
            : "json-bool";
    parts.push(<span key={keyIdx++} className={cls}>{text}</span>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < withValues.length) {
    parts.push(withValues.slice(lastIndex));
  }
  return parts;
}

/**
 * Content-aware tool output renderer.
 *
 * - Detects JSON → pretty-prints with colored syntax
 * - Detects errors → red-tinted background
 * - Truncates long output (>30 lines) with expandable "Show all N lines"
 */
export function ToolOutputBody({ output, isError }: ToolOutputBodyProps) {
  const [expanded, setExpanded] = useState(false);

  const lines = useMemo(() => output.split("\n"), [output]);
  const totalLines = lines.length;
  const shouldTruncate = totalLines > TRUNCATE_THRESHOLD && !expanded;

  const jsonObj = useMemo(() => tryParseJson(output), [output]);
  const isJson = jsonObj !== null;

  const prettyJson = useMemo(
    () => (isJson ? JSON.stringify(jsonObj, null, 2) : null),
    [isJson, jsonObj],
  );

  const jsonLines = useMemo(
    () => (prettyJson ? prettyJson.split("\n") : []),
    [prettyJson],
  );

  const shouldTruncateJson = isJson && jsonLines.length > TRUNCATE_THRESHOLD && !expanded;

  const displayText = useMemo(() => {
    if (isJson) {
      return shouldTruncateJson
        ? jsonLines.slice(0, TRUNCATE_AFTER).join("\n")
        : prettyJson!;
    }
    if (shouldTruncate) return lines.slice(0, TRUNCATE_AFTER).join("\n");
    return output;
  }, [isJson, prettyJson, shouldTruncateJson, jsonLines, shouldTruncate, lines, output]);

  const colorized = useMemo(
    () => (isJson ? colorizeJson(displayText) : null),
    [isJson, displayText],
  );

  const errorClass = isError ? " tool-output--error" : "";
  const jsonClass = isJson ? " tool-output--json" : "";

  return (
    <div>
      <div className="tool-section-label">
        Output{isError ? <span className="tool-output-error-tag"> — error</span> : null}
      </div>
      <pre className={`tool-output${errorClass}${jsonClass}`}>
        {colorized ?? displayText}
      </pre>
      {(shouldTruncate || shouldTruncateJson) && (
        <button
          className="tool-output-expand"
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
        >
          ▾ Show all {isJson ? jsonLines.length : totalLines} lines
        </button>
      )}
    </div>
  );
}
