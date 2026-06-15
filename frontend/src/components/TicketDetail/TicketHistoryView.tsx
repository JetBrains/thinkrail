import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import Editor from "@monaco-editor/react";
import { getClient } from "@/api/index.ts";
import { createBoardApi, type HistoryEntry } from "@/api/methods/board.ts";
import { useMonacoTheme } from "@/components/MarkdownEditor/useMonacoTheme.ts";
import { useFontSize } from "@/utils/fontScale.ts";
import { Dropdown } from "@/components/shared/Dropdown.tsx";

interface Props {
  ticketId: string;
  /** Initial filter (a skill id) applied on mount and whenever the prop
   *  changes from the outside. The user can override via the in-header
   *  dropdown without losing the route signal. */
  phaseFilter?: string;
  /** Auto-expand and scroll to the entry with this index (set when a step is
   *  clicked from the overview's compact history list). */
  expandIndex?: number;
}

const SKILL_LABELS: Record<string, string> = {
  "ticket-product-design": "Product design",
  "ticket-technical-design": "Technical design",
  "ticket-amend-specs": "Amend specs",
  "ticket-implementation-plan": "Implementation plan",
  "ticket-implement": "Implementing",
};

const FILTERABLE_SKILLS: string[] = [
  "ticket-product-design",
  "ticket-technical-design",
  "ticket-amend-specs",
  "ticket-implementation-plan",
  "ticket-implement",
];

export function TicketHistoryView({ ticketId, phaseFilter, expandIndex }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Internal filter state: starts at the prop value, can be overridden
  // by the in-header dropdown. Resync whenever the prop changes so
  // re-routing from elsewhere lands the right filter.
  const [filter, setFilter] = useState<string>(phaseFilter ?? "all");
  useEffect(() => {
    setFilter(phaseFilter ?? "all");
  }, [phaseFilter]);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    const api = createBoardApi(getClient());
    api
      .getHistory(ticketId)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    if (filter === "all") return entries;
    return entries.filter((e) => e.skill === filter);
  }, [entries, filter]);

  const title = filter === "ticket-amend-specs"
    ? "Amendments"
    : filter !== "all"
      ? `Changes — ${SKILL_LABELS[filter] ?? filter}`
      : "History";

  return (
    <div className="ticket-history-view">
      <header className="ticket-artifact-header">
        <h3 className="ticket-artifact-title">
          {title}
          {filtered && <span className="ticket-history-count">({filtered.length})</span>}
        </h3>
        <span className="ticket-history-filter">
          <span className="ticket-history-filter-label">Filter</span>
          <Dropdown<string>
            className="ticket-history-filter-dd"
            value={filter}
            options={[
              { value: "all", label: "All phases" },
              ...FILTERABLE_SKILLS.map((p) => ({ value: p, label: SKILL_LABELS[p] ?? p })),
            ]}
            onChange={setFilter}
            align="right"
            ariaLabel="Filter history by phase"
          />
        </span>
      </header>
      <div className="ticket-history-body">
        {error && <div className="center-placeholder">Error: {error}</div>}
        {!error && entries == null && (
          <div className="center-placeholder">Loading…</div>
        )}
        {!error && filtered != null && filtered.length === 0 && (
          <div className="center-placeholder">No changes recorded yet.</div>
        )}
        {!error && filtered != null && filtered.length > 0 && (
          <ol className="ticket-history-list">
            {filtered.map((entry) => (
              <HistoryEntryCard key={entry.index} entry={entry} expandIndex={expandIndex} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function HistoryEntryCard({ entry, expandIndex }: { entry: HistoryEntry; expandIndex?: number }) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const monacoTheme = useMonacoTheme();
  const fontSize = useFontSize("body");

  const phaseLabel = entry.skill ? SKILL_LABELS[entry.skill] ?? entry.skill : "—";

  // Auto-expand + scroll when a step click from the overview targets this entry.
  // Defer the scroll a frame so the expanded body lays out first; anchor the
  // row header to the top so growth below it doesn't throw off the position.
  useEffect(() => {
    if (expandIndex == null || entry.index !== expandIndex) return;
    setExpanded(true);
    const id = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [expandIndex, entry.index]);

  return (
    <li className="ticket-history-entry" ref={ref}>
      <header
        className="ticket-history-entry-header"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="ticket-history-entry-index">#{entry.index}</span>
        <span className="ticket-history-entry-file" title={entry.filePath}>
          {entry.filePath || "(unknown file)"}
        </span>
        <span className="ticket-history-entry-phase">{phaseLabel}</span>
        <span className="ticket-history-entry-time">
          {entry.timestamp.slice(0, 19).replace("T", " ")}
        </span>
        <span className="ticket-history-entry-chev">
          {expanded ? (
            <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </span>
      </header>
      {expanded && (
        <div className="ticket-history-entry-body">
          {(entry.section || entry.rationale) && (
            <dl className="ticket-history-entry-meta">
              {entry.section && (
                <>
                  <dt>Section</dt>
                  <dd>{entry.section}</dd>
                </>
              )}
              {entry.rationale && (
                <>
                  <dt>Rationale</dt>
                  <dd>{entry.rationale}</dd>
                </>
              )}
              <dt>Applied as</dt>
              <dd>{entry.appliedAs}</dd>
              <dt>Validation</dt>
              <dd>{entry.validation}</dd>
            </dl>
          )}
          <div className="ticket-history-entry-diff">
            <Editor
              height="200px"
              defaultLanguage="diff"
              value={entry.diff}
              theme={monacoTheme}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize,
                lineNumbers: "off",
                scrollBeyondLastLine: false,
                folding: false,
              }}
            />
          </div>
        </div>
      )}
    </li>
  );
}
