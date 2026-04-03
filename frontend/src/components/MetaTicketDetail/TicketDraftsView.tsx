import { useCallback, useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { useMonacoTheme } from "@/components/MarkdownEditor/useMonacoTheme.ts";

interface DraftEntry {
  operation: string;
  realPath: string;
  registryId: string;
  registryTitle: string;
  created: string;
}

interface DraftDiff {
  original: string;
  draft: string;
  path: string;
  operation: string;
  registryId: string;
  registryTitle: string;
}

interface TicketDraftsViewProps {
  ticketId: string;
  onDraftsChanged?: () => void;
}

const OP_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: "NEW", color: "var(--green)" },
  update: { label: "MOD", color: "var(--blue)" },
  delete: { label: "DEL", color: "var(--red)" },
};

export function TicketDraftsView({ ticketId, onDraftsChanged }: TicketDraftsViewProps) {
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [diff, setDiff] = useState<DraftDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const monacoTheme = useMonacoTheme();

  const fetchEntries = useCallback(async () => {
    const api = createBoardApi(getClient());
    const result = await api.listDrafts(ticketId);
    setEntries(result as unknown as DraftEntry[]);
    setLoading(false);
  }, [ticketId]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleSelect = useCallback(async (index: number) => {
    setSelectedIndex(index);
    const api = createBoardApi(getClient());
    const d = await api.getDraftDiff(ticketId, index);
    setDiff(d);
  }, [ticketId]);

  const handleApply = useCallback(async (index: number) => {
    const api = createBoardApi(getClient());
    await api.applyDraft(ticketId, index);
    setSelectedIndex(null);
    setDiff(null);
    await fetchEntries();
    onDraftsChanged?.();
  }, [ticketId, fetchEntries, onDraftsChanged]);

  const handleDiscard = useCallback(async (index: number) => {
    const api = createBoardApi(getClient());
    await api.discardDraft(ticketId, index);
    setSelectedIndex(null);
    setDiff(null);
    await fetchEntries();
    onDraftsChanged?.();
  }, [ticketId, fetchEntries, onDraftsChanged]);

  const handleApplyAll = useCallback(async () => {
    const api = createBoardApi(getClient());
    await api.applyAllDrafts(ticketId);
    setSelectedIndex(null);
    setDiff(null);
    await fetchEntries();
    onDraftsChanged?.();
  }, [ticketId, fetchEntries, onDraftsChanged]);

  const handleDiscardAll = useCallback(async () => {
    const api = createBoardApi(getClient());
    await api.discardAllDrafts(ticketId);
    setSelectedIndex(null);
    setDiff(null);
    await fetchEntries();
    onDraftsChanged?.();
  }, [ticketId, fetchEntries, onDraftsChanged]);

  if (loading) {
    return (
      <div className="ticket-right-panel">
        <div className="ticket-right-header">
          <span className="ticket-right-title">Spec Drafts</span>
        </div>
        <div className="ticket-right-body">
          <div className="ticket-placeholder">Loading drafts...</div>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="ticket-right-panel">
        <div className="ticket-right-header">
          <span className="ticket-right-title">Spec Drafts</span>
        </div>
        <div className="ticket-right-body">
          <div className="ticket-placeholder">No pending spec drafts.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ticket-right-panel">
      <div className="ticket-right-header">
        <span className="ticket-right-title">Spec Drafts</span>
        <span className="ticket-linked-status">{entries.length} pending</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-sm)" }}>
          <button className="ticket-section-action ticket-section-action--primary" onClick={handleApplyAll}>
            Apply All
          </button>
          <button className="ticket-section-action" onClick={handleDiscardAll}>
            Discard All
          </button>
        </div>
      </div>
      <div className="ticket-right-body" style={{ padding: 0 }}>
        {/* Entry list */}
        <div className="ticket-drafts-list">
          {entries.map((entry, i) => {
            const op = OP_LABELS[entry.operation] ?? { label: entry.operation, color: "var(--hint)" };
            return (
              <div
                key={i}
                className={`ticket-drafts-entry ${selectedIndex === i ? "ticket-drafts-entry--active" : ""}`}
                onClick={() => handleSelect(i)}
              >
                <span className="ticket-drafts-op" style={{ color: op.color }}>{op.label}</span>
                <span className="ticket-drafts-path">{entry.realPath}</span>
                <div className="ticket-drafts-actions">
                  <button
                    className="ticket-drafts-action-btn"
                    style={{ color: "var(--green)" }}
                    onClick={(e) => { e.stopPropagation(); handleApply(i); }}
                    title="Apply this draft"
                  >
                    {"\u2713"}
                  </button>
                  <button
                    className="ticket-drafts-action-btn"
                    style={{ color: "var(--red)" }}
                    onClick={(e) => { e.stopPropagation(); handleDiscard(i); }}
                    title="Discard this draft"
                  >
                    {"\u2717"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Diff viewer */}
        {diff && (
          <div className="ticket-drafts-diff">
            <div className="ticket-drafts-diff-header">
              <span>{diff.path}</span>
              <span className="ticket-linked-status">
                {diff.operation === "create" ? "New file" : diff.operation === "delete" ? "Deleted" : "Modified"}
              </span>
            </div>
            <div className="ticket-drafts-diff-editor">
              <DiffEditor
                original={diff.original}
                modified={diff.draft}
                language="markdown"
                theme={monacoTheme}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
                  automaticLayout: true,
                }}
                height="100%"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
