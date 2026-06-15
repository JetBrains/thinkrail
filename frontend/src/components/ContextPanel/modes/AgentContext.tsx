import { useSessionStore } from "@/store/sessionStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import type { ContextUsage, TurnUsage } from "@/types/session.ts";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { fmtTokens, shortPath } from "../utils.tsx";
import "./AgentContext.css";

// ── Helpers ─────────────────────────────────────────────────────────────────

function pctColor(pct: number): string {
  if (pct >= 90) return "var(--red)";
  if (pct >= 70) return "var(--gold)";
  return "var(--blue)";
}

// ── Token Breakdown ─────────────────────────────────────────────────────────

const BREAKDOWN_ITEMS = [
  { key: "inputTokens" as const, label: "Input (fresh)", color: "var(--blue)" },
  { key: "cacheReadTokens" as const, label: "Cache read", color: "var(--green)" },
  { key: "cacheCreationTokens" as const, label: "Cache creation", color: "var(--gold)" },
  { key: "outputTokens" as const, label: "Output", color: "var(--primary, var(--blue))" },
] as const;

function TokenBreakdown({ cu }: { cu: ContextUsage }) {
  const total = cu.inputTokens + cu.cacheReadTokens + cu.cacheCreationTokens + cu.outputTokens;
  if (total === 0) return <div className="agent-context__empty">No token data yet</div>;

  return (
    <div className="agent-context__breakdown">
      <div className="agent-context__stacked-bar">
        {BREAKDOWN_ITEMS.map(({ key, color }) => {
          const w = total > 0 ? (cu[key] / total) * 100 : 0;
          return w > 0 ? (
            <span key={key} style={{ width: `${w}%`, background: color }} />
          ) : null;
        })}
      </div>
      {BREAKDOWN_ITEMS.map(({ key, label, color }) => (
        <div key={key} className="agent-context__breakdown-row">
          <span className="agent-context__breakdown-dot" style={{ background: color }} />
          <span className="agent-context__breakdown-label">{label}</span>
          <span className="agent-context__breakdown-value">{fmtTokens(cu[key])}</span>
        </div>
      ))}
    </div>
  );
}

// ── Turn History ────────────────────────────────────────────────────────────

function TurnHistory({
  turns,
  runBoundaries,
  liveTurn,
}: {
  turns: TurnUsage[];
  runBoundaries: number[];
  liveTurn?: TurnUsage | null;
}) {
  if (turns.length === 0 && !liveTurn) return <div className="agent-context__empty">No turns yet</div>;

  const boundarySet = new Set(runBoundaries);
  const totalSdkTurns = turns.reduce((sum, t) => sum + t.sdkTurns, 0);

  const rows: React.ReactNode[] = [];
  let runCounter = 0;

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];

    if (boundarySet.has(i)) {
      runCounter++;
      if (runCounter > 1) {
        rows.push(
          <div key={`run-${runCounter}`} className="agent-context__run-separator">
            <span>Run {runCounter} (resumed)</span>
          </div>,
        );
      }
    }

    rows.push(
      <div key={t.turnIndex} className="agent-context__turn-row">
        <span className="agent-context__turn-dim">{t.turnIndex + 1}</span>
        <span>{fmtTokens(t.inputTokens)}</span>
        <span>{fmtTokens(t.outputTokens)}</span>
        <span>${t.costUsd.toFixed(2)}</span>
      </div>,
    );
  }

  if (liveTurn) {
    rows.push(
      <div key="live" className="agent-context__turn-row agent-context__turn-row--live">
        <span className="agent-context__turn-dim">
          <span className="agent-context__turn-live-dot" />
          {liveTurn.turnIndex + 1}
        </span>
        <span>{fmtTokens(liveTurn.inputTokens)}</span>
        <span>{fmtTokens(liveTurn.outputTokens)}</span>
        <span>~${liveTurn.costUsd.toFixed(2)}</span>
      </div>,
    );
  }

  return (
    <div className="agent-context__turns">
      <div className="agent-context__turn-row agent-context__turn-header text-uppercase">
        <span>#</span>
        <span>Input</span>
        <span>Output</span>
        <span>Cost</span>
      </div>
      {rows}
      {totalSdkTurns > turns.length && (
        <div className="agent-context__turns-summary">
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
  const allTools = new Set([...Object.keys(counts), ...Object.keys(toolTokens)]);
  if (allTools.size === 0) return <div className="agent-context__empty">No tool calls yet</div>;

  const rows = [...allTools]
    .map((name) => {
      const c = counts[name] ?? 0;
      const t = toolTokens[name] ?? { inputTokens: 0, outputTokens: 0 };
      return { name, calls: c, inTok: t.inputTokens, outTok: t.outputTokens, total: t.inputTokens + t.outputTokens };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <div className="agent-context__tool-table">
      <div className="agent-context__tool-row agent-context__tool-header text-uppercase">
        <span>Tool</span>
        <span>Calls</span>
        <span>In ~tok</span>
        <span>Out ~tok</span>
      </div>
      {rows.map((r) => (
        <div key={r.name} className="agent-context__tool-row">
          <span className="agent-context__tool-name" title={r.name}>{r.name}</span>
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
    return <div className="agent-context__empty">No files accessed yet</div>;
  }

  return (
    <div className="agent-context__files">
      {filesRead.length > 0 && (
        <>
          <div className="agent-context__file-label text-uppercase">Read ({filesRead.length})</div>
          {filesRead.slice(0, MAX_FILES).map((f) => (
            <div
              key={f}
              className="agent-context__file-entry"
              title={f}
              onClick={() => loadPreview(f)}
            >
              {shortPath(f)}
            </div>
          ))}
          {filesRead.length > MAX_FILES && (
            <div className="agent-context__file-more">+{filesRead.length - MAX_FILES} more</div>
          )}
        </>
      )}
      {filesWritten.length > 0 && (
        <>
          <div className="agent-context__file-label text-uppercase">Written ({filesWritten.length})</div>
          {filesWritten.slice(0, MAX_FILES).map((f) => (
            <div
              key={f}
              className="agent-context__file-entry"
              title={f}
              onClick={() => loadPreview(f)}
            >
              {shortPath(f)}
            </div>
          ))}
          {filesWritten.length > MAX_FILES && (
            <div className="agent-context__file-more">+{filesWritten.length - MAX_FILES} more</div>
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

  if (totalInput === 0) return <div className="agent-context__empty">No cache data yet</div>;

  return (
    <div>
      <div className="agent-context__cache-row">
        <span className="agent-context__cache-label">Cache hit rate</span>
        <span className="agent-context__cache-value" style={{ color: hitRate > 50 ? "var(--green)" : "var(--gold)" }}>
          {hitRate}%
        </span>
      </div>
      <div className="agent-context__cache-bar">
        <div
          className="agent-context__cache-fill"
          style={{
            width: `${hitRate}%`,
            background: hitRate > 50 ? "var(--green)" : "var(--gold)",
          }}
        />
      </div>
      <div className="agent-context__cache-row" style={{ marginTop: 6 }}>
        <span className="agent-context__cache-label">Cache read</span>
        <span className="agent-context__cache-value">{fmtTokens(cu.cacheReadTokens)}</span>
      </div>
      <div className="agent-context__cache-row">
        <span className="agent-context__cache-label">Cache creation</span>
        <span className="agent-context__cache-value">{fmtTokens(cu.cacheCreationTokens)}</span>
      </div>
      <div className="agent-context__cache-row">
        <span className="agent-context__cache-label">Fresh input</span>
        <span className="agent-context__cache-value">{fmtTokens(cu.inputTokens)}</span>
      </div>
    </div>
  );
}

// ── Main AgentContext ────────────────────────────────────────────────────────

export function AgentContext() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const session = useSessionStore((s) =>
    s.activeSessionId ? s.sessions.get(s.activeSessionId) : undefined,
  );

  if (!activeSessionId || !session) {
    return <div className="agent-context__empty">No active session</div>;
  }

  const { contextUsage: cu } = session.metrics;
  const pct = cu.contextMax > 0
    ? Math.round((cu.contextTokens / cu.contextMax) * 100)
    : 0;
  const color = pctColor(pct);
  const totalTools = Object.values(cu.toolCallCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="agent-context">
      {/* Utilization header — always visible */}
      <div className="agent-context__header">
        <div className="agent-context__pct" style={{ color }}>{pct}%</div>
        <div className="agent-context__pct-bar">
          <div
            className="agent-context__pct-fill"
            style={{ width: `${Math.min(pct, 100)}%`, background: color }}
          />
        </div>
        <div className="agent-context__meta">
          {fmtTokens(cu.contextTokens)} / {fmtTokens(cu.contextMax)}
        </div>
      </div>

      <CollapsibleSection title="Token Breakdown" defaultExpanded>
        <TokenBreakdown cu={cu} />
      </CollapsibleSection>

      <CollapsibleSection title="Turn History" count={cu.turnHistory.length + (cu.liveTurn ? 1 : 0)}>
        <TurnHistory turns={cu.turnHistory} runBoundaries={cu.runBoundaries} liveTurn={cu.liveTurn} />
      </CollapsibleSection>

      <CollapsibleSection title="Tool Calls" count={totalTools}>
        <ToolCalls counts={cu.toolCallCounts} toolTokens={cu.toolTokens} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Files Accessed"
        count={cu.filesRead.length + cu.filesWritten.length}
      >
        <FilesAccessed filesRead={cu.filesRead} filesWritten={cu.filesWritten} />
      </CollapsibleSection>

      <CollapsibleSection title="Cache Stats">
        <CacheStats cu={cu} />
      </CollapsibleSection>
    </div>
  );
}
