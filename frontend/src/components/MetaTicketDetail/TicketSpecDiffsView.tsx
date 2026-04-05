import { useCallback, useEffect, useRef, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { useMonacoTheme } from "@/components/MarkdownEditor/useMonacoTheme.ts";
import type { MetaTicket } from "@/types/board.ts";

/**
 * Wrapper that detaches models before unmount to avoid the Monaco
 * "TextModel got disposed before DiffEditorWidget model got reset" error.
 */
function SafeDiffEditor(props: React.ComponentProps<typeof DiffEditor>) {
  const editorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);

  useEffect(() => {
    return () => {
      if (editorRef.current) {
        try { editorRef.current.setModel(null); } catch { /* ignore */ }
        editorRef.current = null;
      }
    };
  }, []);

  const handleMount: DiffOnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    props.onMount?.(editor, monaco);
  }, [props.onMount]);

  return <DiffEditor {...props} onMount={handleMount} />;
}

type Tab = "pending" | "history";

interface DraftEntry {
  operation: string;
  realPath: string;
  registryId: string;
  registryTitle: string;
  created: string;
}

interface DiffData {
  original: string;
  modified: string;
  path: string;
  operation: string;
}

interface TicketSpecDiffsViewProps {
  ticketId: string;
  ticket: MetaTicket;
  onTicketUpdated: (t: MetaTicket) => void;
}

const OP_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: "NEW", color: "var(--green)" },
  created: { label: "NEW", color: "var(--green)" },
  update: { label: "MOD", color: "var(--blue)" },
  modified: { label: "MOD", color: "var(--blue)" },
  delete: { label: "DEL", color: "var(--red)" },
  deleted: { label: "DEL", color: "var(--red)" },
};

export function TicketSpecDiffsView({ ticketId, ticket, onTicketUpdated }: TicketSpecDiffsViewProps) {
  const [tab, setTab] = useState<Tab>("pending");
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const monacoTheme = useMonacoTheme();

  const fetchEntries = useCallback(async () => {
    const api = createBoardApi(getClient());
    const result = await api.listDrafts(ticketId);
    setEntries(result as unknown as DraftEntry[]);
    setLoading(false);
  }, [ticketId]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Auto-switch to history tab when no pending drafts
  useEffect(() => {
    if (!loading && entries.length === 0 && (ticket.specPatches?.length ?? 0) > 0) {
      setTab("history");
    }
  }, [loading, entries.length, ticket.specPatches?.length]);

  const handleSelectDraft = useCallback(async (index: number) => {
    setSelectedIndex(index);
    const api = createBoardApi(getClient());
    const d = await api.getDraftDiff(ticketId, index);
    setDiff({ original: d.original, modified: d.draft, path: d.path, operation: d.operation });
  }, [ticketId]);

  const handleSelectPatch = useCallback(async (index: number) => {
    setSelectedIndex(index);
    const api = createBoardApi(getClient());
    const d = await api.getPatchDiff(ticketId, index);
    setDiff(d);
  }, [ticketId]);

  const handleDiscard = useCallback(async (index: number) => {
    const api = createBoardApi(getClient());
    await api.discardDraft(ticketId, index);
    setSelectedIndex(null);
    setDiff(null);
    await fetchEntries();
  }, [ticketId, fetchEntries]);

  const handleApproveAll = useCallback(async () => {
    const api = createBoardApi(getClient());
    await api.applyAllDrafts(ticketId);
    setSelectedIndex(null);
    setDiff(null);
    await fetchEntries();
    const updated = await api.get(ticketId);
    onTicketUpdated(updated);
  }, [ticketId, fetchEntries, onTicketUpdated]);

  const handleRevert = useCallback(async (index: number) => {
    const api = createBoardApi(getClient());
    const updated = await api.revertPatch(ticketId, index);
    onTicketUpdated(updated);
    setSelectedIndex(null);
    setDiff(null);
  }, [ticketId, onTicketUpdated]);

  const patches = ticket.specPatches ?? [];
  const pendingCount = entries.length;
  const historyCount = patches.length;

  return (
    <div className="ticket-right-panel">
      <div className="ticket-right-header">
        <span className="ticket-right-title">Spec Diffs</span>
      </div>
      {/* Tabs */}
      <div className="spec-view-tabs">
        <button
          className={`spec-view-tab ${tab === "pending" ? "spec-view-tab--active" : ""}`}
          onClick={() => { setTab("pending"); setSelectedIndex(null); setDiff(null); }}
        >
          Pending
          {pendingCount > 0 && <span className="spec-view-count" style={{ background: "var(--yellow-dim, #432)", color: "var(--yellow, #fb3)" }}>{pendingCount}</span>}
        </button>
        <button
          className={`spec-view-tab ${tab === "history" ? "spec-view-tab--active" : ""}`}
          onClick={() => { setTab("history"); setSelectedIndex(null); setDiff(null); }}
        >
          History
          {historyCount > 0 && <span className="spec-view-count">{historyCount}</span>}
        </button>
        {tab === "pending" && pendingCount > 0 && (
          <button className="spec-view-save" onClick={handleApproveAll}>
            Approve All
          </button>
        )}
      </div>
      <div className="ticket-right-body" style={{ padding: 0 }}>
        {/* Pending tab */}
        {tab === "pending" && (
          loading ? (
            <div className="ticket-placeholder" style={{ padding: "var(--space-lg)" }}>Loading drafts...</div>
          ) : entries.length === 0 ? (
            <div className="ticket-placeholder" style={{ padding: "var(--space-lg)" }}>No pending spec drafts.</div>
          ) : (
            <>
              <div className="spec-diffs-list">
                {entries.map((entry, i) => {
                  const op = OP_LABELS[entry.operation] ?? { label: entry.operation, color: "var(--hint)" };
                  return (
                    <div
                      key={i}
                      className={`spec-diffs-entry ${selectedIndex === i ? "spec-diffs-entry--active" : ""}`}
                      onClick={() => handleSelectDraft(i)}
                    >
                      <span className="spec-diffs-op" style={{ color: op.color }}>{op.label}</span>
                      <span className="spec-diffs-label">{entry.registryTitle || entry.realPath}</span>
                      <button
                        className="spec-diffs-discard"
                        onClick={(e) => { e.stopPropagation(); handleDiscard(i); }}
                        title="Discard"
                      >
                        {"\u2717"}
                      </button>
                    </div>
                  );
                })}
              </div>
              {diff && (
                <div className="spec-diffs-editor">
                  <div className="spec-diffs-editor-header">
                    <span>{diff.path}</span>
                    <span className="spec-diffs-editor-op">
                      {diff.operation === "create" ? "New file" : diff.operation === "delete" ? "Deleted" : "Modified"}
                    </span>
                  </div>
                  <div className="spec-diffs-monaco">
                    <SafeDiffEditor
                      original={diff.original}
                      modified={diff.modified}
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
            </>
          )
        )}
        {/* History tab */}
        {tab === "history" && (
          patches.length === 0 ? (
            <div className="ticket-placeholder" style={{ padding: "var(--space-lg)" }}>No applied patches yet.</div>
          ) : (
            <>
              <div className="spec-diffs-list">
                {patches.map((p, i) => {
                  const op = OP_LABELS[p.operation] ?? { label: p.operation, color: "var(--hint)" };
                  return (
                    <div
                      key={i}
                      className={`spec-diffs-entry ${selectedIndex === i ? "spec-diffs-entry--active" : ""}`}
                      onClick={() => handleSelectPatch(i)}
                    >
                      <span className="spec-diffs-op" style={{ color: "var(--muted)" }}>{op.label}</span>
                      <span className="spec-diffs-label">{p.specTitle}</span>
                      <span className="spec-diffs-time">{p.created?.slice(0, 10) ?? ""}</span>
                      <button
                        className="spec-diffs-discard"
                        onClick={(e) => { e.stopPropagation(); handleRevert(i); }}
                        title="Revert"
                      >
                        {"\u21B6"}
                      </button>
                    </div>
                  );
                })}
              </div>
              {diff && (
                <div className="spec-diffs-editor">
                  <div className="spec-diffs-editor-header">
                    <span>{diff.path}</span>
                    <span className="spec-diffs-editor-op">{diff.operation}</span>
                  </div>
                  <div className="spec-diffs-monaco">
                    <SafeDiffEditor
                      original={diff.original}
                      modified={diff.modified}
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
            </>
          )
        )}
      </div>
    </div>
  );
}
