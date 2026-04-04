import { useCallback, useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { DiffEditor } from "@monaco-editor/react";
import { getClient } from "@/api/index.ts";
import { createSpecApi } from "@/api/methods/specs.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import { useMonacoTheme } from "@/components/MarkdownEditor/useMonacoTheme.ts";
import { MarkdownPreview } from "@/components/FileViewer/MarkdownPreview.tsx";
import type { MetaTicket } from "@/types/board.ts";
import type { SpecDetail } from "@/types/spec.ts";

type Tab = "preview" | "source" | "diff";

interface DraftEntry {
  index: number;
  operation: string;
  registryId: string;
  registryTitle: string;
}

interface DiffItem {
  type: "pending" | "applied";
  label: string;
  operation: string;
  index: number;
  timestamp?: string;
}

interface TicketSpecViewProps {
  specId: string;
  specTitle: string;
  ticketId: string;
  ticket: MetaTicket;
}

const OP_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: "NEW", color: "var(--green)" },
  created: { label: "NEW", color: "var(--green)" },
  update: { label: "MOD", color: "var(--blue)" },
  modified: { label: "MOD", color: "var(--blue)" },
  delete: { label: "DEL", color: "var(--red)" },
  deleted: { label: "DEL", color: "var(--red)" },
};

export function TicketSpecView({ specId, specTitle, ticketId, ticket }: TicketSpecViewProps) {
  const [tab, setTab] = useState<Tab>("preview");
  const [spec, setSpec] = useState<SpecDetail | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [diffItems, setDiffItems] = useState<DiffItem[]>([]);
  const [selectedDiff, setSelectedDiff] = useState<number | null>(null);
  const [diffData, setDiffData] = useState<{ original: string; modified: string } | null>(null);
  const monacoTheme = useMonacoTheme();

  // Fetch spec content
  useEffect(() => {
    const api = createSpecApi(getClient());
    api.get(specId).then((s) => {
      setSpec(s);
      setEditContent(s.content);
      setDirty(false);
    }).catch(() => {});
  }, [specId]);

  // Build diff items from pending drafts + applied patches
  useEffect(() => {
    const items: DiffItem[] = [];

    // Applied patches for this spec
    const patches = ticket.specPatches?.filter((p) => p.specId === specId) ?? [];
    for (const p of patches) {
      const globalIndex = ticket.specPatches.indexOf(p);
      items.push({
        type: "applied",
        label: p.specTitle,
        operation: p.operation,
        index: globalIndex,
        timestamp: p.created,
      });
    }

    // Pending drafts for this spec
    const boardApi = createBoardApi(getClient());
    boardApi.listDrafts(ticketId).then((entries) => {
      const drafts = entries as unknown as DraftEntry[];
      for (let i = 0; i < drafts.length; i++) {
        if (drafts[i].registryId === specId) {
          items.unshift({
            type: "pending",
            label: drafts[i].registryTitle || specTitle,
            operation: drafts[i].operation,
            index: i,
          });
        }
      }
      setDiffItems([...items]);
    }).catch(() => setDiffItems(items));
  }, [specId, ticketId, ticket.specPatches, specTitle]);

  const handleSave = useCallback(async () => {
    if (!spec) return;
    setSaving(true);
    const api = createSpecApi(getClient());
    const updated = await api.update(specId, editContent);
    setSpec(updated);
    setDirty(false);
    setSaving(false);
  }, [specId, editContent, spec]);

  const handleSelectDiff = useCallback(async (item: DiffItem, idx: number) => {
    setSelectedDiff(idx);
    const boardApi = createBoardApi(getClient());
    if (item.type === "pending") {
      const d = await boardApi.getDraftDiff(ticketId, item.index);
      setDiffData({ original: d.original, modified: d.draft });
    } else {
      const d = await boardApi.getPatchDiff(ticketId, item.index);
      setDiffData({ original: d.original, modified: d.modified });
    }
  }, [ticketId]);

  if (!spec) {
    return (
      <div className="ticket-right-panel">
        <div className="ticket-right-header">
          <span className="ticket-right-title">Spec: {specTitle}</span>
        </div>
        <div className="ticket-right-body">
          <div className="ticket-placeholder">Loading spec...</div>
        </div>
      </div>
    );
  }

  const diffCount = diffItems.length;

  return (
    <div className="ticket-right-panel">
      <div className="ticket-right-header">
        <span className="ticket-right-title">Spec: {specTitle}</span>
      </div>
      {/* Metadata bar */}
      <div className="spec-view-meta">
        <span className="spec-view-badge">{spec.type}</span>
        <span className={`spec-view-badge spec-view-badge--${spec.status}`}>{spec.status}</span>
        {spec.tags?.map((t) => (
          <span key={t} className="spec-view-tag">{t}</span>
        ))}
      </div>
      {/* Tabs */}
      <div className="spec-view-tabs">
        <button
          className={`spec-view-tab ${tab === "preview" ? "spec-view-tab--active" : ""}`}
          onClick={() => setTab("preview")}
        >
          Preview
        </button>
        <button
          className={`spec-view-tab ${tab === "source" ? "spec-view-tab--active" : ""}`}
          onClick={() => setTab("source")}
        >
          Source
          {dirty && <span className="spec-view-dot" />}
        </button>
        <button
          className={`spec-view-tab ${tab === "diff" ? "spec-view-tab--active" : ""}`}
          onClick={() => setTab("diff")}
        >
          Diff
          {diffCount > 0 && <span className="spec-view-count">{diffCount}</span>}
        </button>
        {tab === "source" && (
          <button
            className="spec-view-save"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        )}
      </div>
      {/* Tab content */}
      <div className="spec-view-content">
        {tab === "preview" && (
          <div className="spec-view-preview">
            <MarkdownPreview content={spec.content} />
          </div>
        )}
        {tab === "source" && (
          <Editor
            value={editContent}
            language="markdown"
            theme={monacoTheme}
            onChange={(val) => { setEditContent(val ?? ""); setDirty(true); }}
            options={{
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
              wordWrap: "on",
              automaticLayout: true,
              padding: { top: 8 },
            }}
          />
        )}
        {tab === "diff" && (
          <div className="spec-view-diff-layout">
            {diffItems.length === 0 ? (
              <div className="ticket-placeholder">No changes recorded for this spec.</div>
            ) : (
              <>
                <div className="spec-diffs-list">
                  {diffItems.map((item, i) => {
                    const op = OP_LABELS[item.operation] ?? { label: item.operation, color: "var(--hint)" };
                    return (
                      <div
                        key={`${item.type}-${item.index}`}
                        className={`spec-diffs-entry ${selectedDiff === i ? "spec-diffs-entry--active" : ""}`}
                        onClick={() => handleSelectDiff(item, i)}
                      >
                        <span className="spec-diffs-op" style={{ color: item.type === "applied" ? "var(--muted)" : op.color }}>
                          {op.label}
                        </span>
                        <span className="spec-diffs-label">{item.type === "pending" ? "Pending" : item.timestamp?.slice(0, 10) ?? ""}</span>
                      </div>
                    );
                  })}
                </div>
                {diffData && (
                  <div className="spec-diffs-editor">
                    <DiffEditor
                      original={diffData.original}
                      modified={diffData.modified}
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
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
