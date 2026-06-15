import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import type { ArtifactKind } from "@/types/board.ts";
import { MarkdownEditor } from "@/components/MarkdownEditor/MarkdownEditor.tsx";
import { useMonacoTheme } from "@/components/MarkdownEditor/useMonacoTheme.ts";
import { useFontSize } from "@/utils/fontScale.ts";
import { useTicketStateStore } from "@/store/ticketStateStore.ts";

interface Props {
  ticketId: string;
  kind: ArtifactKind;
}

const LABELS: Record<ArtifactKind, string> = {
  product_design: "Product design",
  technical_design: "Technical design",
  history: "History",
  implementation_plan: "Implementation plan",
};

// Mirrors backend artifact_paths.ARTIFACT_FILENAMES — the on-disk filename
// each kind resolves to under .tr/tickets/{id}/.
const FILENAMES: Record<ArtifactKind, string> = {
  product_design: "product-design.md",
  technical_design: "technical-design.md",
  history: "history.patch",
  implementation_plan: "implementation-plan.md",
};

export function TicketArtifactView({ ticketId, kind }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const monacoTheme = useMonacoTheme();
  const fontSize = useFontSize("body");
  const ticketRev = useTicketStateStore((s) => s.states.get(ticketId)?.rev ?? 0);
  // Bumped when the watcher reports this artifact's file changed on disk, so
  // the preview refreshes live while a stage session writes it (the file is
  // written via the Write tool, which never bumps ticketRev).
  const [fileRev, setFileRev] = useState(0);

  useEffect(() => {
    const expected = `.tr/tickets/${ticketId}/${FILENAMES[kind]}`;
    const unsub = getClient().on("file/didChange", (p: unknown) => {
      const path = (p as { path?: string }).path;
      if (path === expected) setFileRev((n) => n + 1);
    });
    return () => { unsub(); };
  }, [ticketId, kind]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const api = createBoardApi(getClient());
    api
      .readArtifact(ticketId, kind)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, kind, ticketRev, fileRev]);

  return (
    <div className="ticket-artifact-view">
      <header className="ticket-artifact-header">
        <h3 className="ticket-artifact-title">
          {LABELS[kind]}
        </h3>
      </header>
      <div className="ticket-artifact-body">
        {loading && <div className="center-placeholder">Loading…</div>}
        {!loading && content == null && (
          <div className="center-placeholder">No {(LABELS[kind] ?? String(kind)).toLowerCase()} on disk yet.</div>
        )}
        {!loading && content === "" && (
          <div className="center-placeholder">(empty file)</div>
        )}
        {!loading && content != null && content !== "" && (
          kind === "history" ? (
            <Editor
              height="100%"
              defaultLanguage="diff"
              value={content}
              theme={monacoTheme}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
              }}
            />
          ) : (
            <MarkdownEditor
              value={content}
              onChange={() => { /* read-only */ }}
              preview={true}
              initialMode="preview"
            />
          )
        )}
      </div>
    </div>
  );
}
