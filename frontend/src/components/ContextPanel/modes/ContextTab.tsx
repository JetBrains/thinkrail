import { useState } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import type { ContextUsage, TurnUsage } from "@/types/session.ts";
import "./ContextTab.css";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function pctColor(pct: number): string {
  if (pct >= 90) return "var(--red)";
  if (pct >= 70) return "var(--gold)";
  return "var(--green)";
}

// ── Collapsible Section ─────────────────────────────────────────────────────

function Section({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ctx-tab-section">
      <div className="ctx-tab-heading" onClick={() => setOpen((v) => !v)}>
        <span>{open ? "\u25BE" : "\u25B8"}</span>
        {title}
        {badge && <span className="ctx-tab-heading-badge">{badge}</span>}
      </div>
      {open && children}
    </div>
  );
}

// ── Token Breakdown ─────────────────────────────────────────────────────────

const BREAKDOWN_ITEMS = [
  { key: "inputTokens" as const, label: "Input (fresh)", color: "var(--blue)" },
  { key: "cacheReadTokens" as const, label: "Cache read", color: "var(--green)" },
  { key: "cacheCreationTokens" as const, label: "Cache creation", color: "var(--gold)" },
  { key: "outputTokens" as const, label: "Output", color: "var(--purple, var(--cyan))" },
] as const;

function TokenBreakdown({ cu }: { cu: ContextUsage }) {
  const total = cu.inputTokens + cu.cacheReadTokens + cu.cacheCreationTokens + cu.outputTokens;
  if (total === 0) return <div className="ctx-tab-empty">No token data yet</div>;

  return (
    <div className="ctx-tab-breakdown">
      <div className="ctx-tab-stacked-bar">
        {BREAKDOWN_ITEMS.map(({ key, color }) => {
          const w = total > 0 ? (cu[key] / total) * 100 : 0;
          return w > 0 ? (
            <span key={key} style={{ width: `${w}%`, background: color }} />
          ) : null;
        })}
      </div>
      {BREAKDOWN_ITEMS.map(({ key, label, color }) => (
        <div key={key} className="ctx-tab-breakdown-row">
          <span className="ctx-tab-breakdown-dot" style={{ background: color }} />
          <span className="ctx-tab-breakdown-label">{label}</span>
          <span className="ctx-tab-breakdown-value">{fmtTokens(cu[key])}</span>
        </div>
      ))}
    </div>
  );
}

// ── Turn History ────────────────────────────────────────────────────────────

function TurnHistory({ turns, runBoundaries }: { turns: TurnUsage[]; runBoundaries: number[] }) {
  if (turns.length === 0) return <div className="ctx-tab-empty">No turns yet</div>;

  // Build a set for O(1) boundary lookups
  const boundarySet = new Set(runBoundaries);

  // Total SDK turns for the summary stat
  const totalSdkTurns = turns.reduce((sum, t) => sum + t.sdkTurns, 0);

  const rows: React.ReactNode[] = [];
  let runCounter = 0;

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];

    // Run separator
    if (boundarySet.has(i)) {
      runCounter++;
      // Skip separator for the very first run (run 1)
      if (runCounter > 1) {
        rows.push(
          <div key={`run-${runCounter}`} className="ctx-tab-run-separator">
            <span>Run {runCounter} (resumed)</span>
          </div>,
        );
      }
    }

    rows.push(
      <div key={t.turnIndex} className="ctx-tab-turn-row">
        <span className="ctx-tab-turn-dim">{t.turnIndex + 1}</span>
        <span>{fmtTokens(t.inputTokens)}</span>
        <span>{fmtTokens(t.outputTokens)}</span>
        <span>${t.costUsd.toFixed(2)}</span>
      </div>,
    );
  }

  return (
    <div className="ctx-tab-turns">
      <div className="ctx-tab-turn-row ctx-tab-turn-header">
        <span>#</span>
        <span>Input</span>
        <span>Output</span>
        <span>Cost</span>
      </div>
      {rows}
      {totalSdkTurns > turns.length && (
        <div className="ctx-tab-turns-summary">
          {turns.length} exchanges · {totalSdkTurns} SDK turns total
        </div>
      )}
    </div>
  );
}

// ── Tool Calls ──────────────────────────────────────────────────────────────

function ToolCalls({
  counts,
  toolTokens,
}: {
  counts: Record<string, number>;
  toolTokens: Record<string, { inputTokens: number; outputTokens: number }>;
}) {
  // Merge tool names from both records
  const allTools = new Set([...Object.keys(counts), ...Object.keys(toolTokens)]);
  if (allTools.size === 0) return <div className="ctx-tab-empty">No tool calls yet</div>;

  const rows = [...allTools]
    .map((name) => {
      const c = counts[name] ?? 0;
      const t = toolTokens[name] ?? { inputTokens: 0, outputTokens: 0 };
      return { name, calls: c, inTok: t.inputTokens, outTok: t.outputTokens, total: t.inputTokens + t.outputTokens };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <div className="ctx-tab-tool-table">
      <div className="ctx-tab-tool-row ctx-tab-tool-header">
        <span>Tool</span>
        <span>Calls</span>
        <span>In ~tok</span>
        <span>Out ~tok</span>
      </div>
      {rows.map((r) => (
        <div key={r.name} className="ctx-tab-tool-row">
          <span className="ctx-tab-tool-name" title={r.name}>{r.name}</span>
          <span>{r.calls}</span>
          <span>{fmtTokens(r.inTok)}</span>
          <span>{fmtTokens(r.outTok)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Files Accessed ──────────────────────────────────────────────────────────

const MAX_FILES = 10;

function FilesAccessed({ filesRead, filesWritten }: { filesRead: string[]; filesWritten: string[] }) {
  const loadPreview = useFileStore((s) => s.loadPreview);

  if (filesRead.length === 0 && filesWritten.length === 0) {
    return <div className="ctx-tab-empty">No files accessed yet</div>;
  }

  const shortPath = (p: string) => {
    const parts = p.split("/");
    return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : p;
  };

  return (
    <div className="ctx-tab-files">
      {filesRead.length > 0 && (
        <>
          <div className="ctx-tab-file-label">Read ({filesRead.length})</div>
          {filesRead.slice(0, MAX_FILES).map((f) => (
            <div
              key={f}
              className="ctx-tab-file-entry"
              title={f}
              onClick={() => loadPreview(f)}
            >
              {shortPath(f)}
            </div>
          ))}
          {filesRead.length > MAX_FILES && (
            <div className="ctx-tab-file-more">+{filesRead.length - MAX_FILES} more</div>
          )}
        </>
      )}
      {filesWritten.length > 0 && (
        <>
          <div className="ctx-tab-file-label">Written ({filesWritten.length})</div>
          {filesWritten.slice(0, MAX_FILES).map((f) => (
            <div
              key={f}
              className="ctx-tab-file-entry"
              title={f}
              onClick={() => loadPreview(f)}
            >
              {shortPath(f)}
            </div>
          ))}
          {filesWritten.length > MAX_FILES && (
            <div className="ctx-tab-file-more">+{filesWritten.length - MAX_FILES} more</div>
          )}
        </>
      )}
    </div>
  );
}

// ── Cache Stats ─────────────────────────────────────────────────────────────

function CacheStats({ cu }: { cu: ContextUsage }) {
  const totalInput = cu.inputTokens + cu.cacheReadTokens + cu.cacheCreationTokens;
  const hitRate = totalInput > 0 ? Math.round((cu.cacheReadTokens / totalInput) * 100) : 0;

  if (totalInput === 0) return <div className="ctx-tab-empty">No cache data yet</div>;

  return (
    <div>
      <div className="ctx-tab-cache-row">
        <span className="ctx-tab-cache-label">Cache hit rate</span>
        <span className="ctx-tab-cache-value" style={{ color: hitRate > 50 ? "var(--green)" : "var(--gold)" }}>
          {hitRate}%
        </span>
      </div>
      <div className="ctx-tab-cache-bar">
        <div
          className="ctx-tab-cache-fill"
          style={{
            width: `${hitRate}%`,
            background: hitRate > 50 ? "var(--green)" : "var(--gold)",
          }}
        />
      </div>
      <div className="ctx-tab-cache-row" style={{ marginTop: 6 }}>
        <span className="ctx-tab-cache-label">Cache read</span>
        <span className="ctx-tab-cache-value">{fmtTokens(cu.cacheReadTokens)}</span>
      </div>
      <div className="ctx-tab-cache-row">
        <span className="ctx-tab-cache-label">Cache creation</span>
        <span className="ctx-tab-cache-value">{fmtTokens(cu.cacheCreationTokens)}</span>
      </div>
      <div className="ctx-tab-cache-row">
        <span className="ctx-tab-cache-label">Fresh input</span>
        <span className="ctx-tab-cache-value">{fmtTokens(cu.inputTokens)}</span>
      </div>
    </div>
  );
}

// ── Main ContextTab ─────────────────────────────────────────────────────────

export function ContextTab() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const session = useSessionStore((s) =>
    s.activeSessionId ? s.sessions.get(s.activeSessionId) : undefined,
  );

  if (!activeSessionId || !session) {
    return <div className="ctx-tab-empty">No active session</div>;
  }

  const { contextUsage: cu } = session.metrics;
  const pct = cu.contextMax > 0
    ? Math.round((cu.contextTokens / cu.contextMax) * 100)
    : 0;
  const color = pctColor(pct);
  const totalTools = Object.values(cu.toolCallCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="ctx-tab">
      {/* Utilization header */}
      <div className="ctx-tab-summary">
        <div className="ctx-tab-pct" style={{ color }}>{pct}%</div>
        <div className="ctx-tab-pct-bar">
          <div
            className="ctx-tab-pct-fill"
            style={{ width: `${Math.min(pct, 100)}%`, background: color }}
          />
        </div>
        <div className="ctx-tab-meta">
          {fmtTokens(cu.contextTokens)} / {fmtTokens(cu.contextMax)}
        </div>
      </div>

      <Section title="Token Breakdown" defaultOpen>
        <TokenBreakdown cu={cu} />
      </Section>

      <Section title="Turn History" badge={`${cu.turnHistory.length} turns`}>
        <TurnHistory turns={cu.turnHistory} runBoundaries={cu.runBoundaries} />
      </Section>

      <Section title="Tool Calls" badge={`${totalTools} total`}>
        <ToolCalls counts={cu.toolCallCounts} toolTokens={cu.toolTokens} />
      </Section>

      <Section
        title="Files Accessed"
        badge={`${cu.filesRead.length} read, ${cu.filesWritten.length} written`}
      >
        <FilesAccessed filesRead={cu.filesRead} filesWritten={cu.filesWritten} />
      </Section>

      <Section title="Cache Stats">
        <CacheStats cu={cu} />
      </Section>
    </div>
  );
}
