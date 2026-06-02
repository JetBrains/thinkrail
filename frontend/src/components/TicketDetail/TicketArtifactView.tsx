import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { getClient } from "@/api/index.ts";
import { createBoardApi } from "@/api/methods/board.ts";
import type { ArtifactKind } from "@/types/board.ts";
import { MarkdownEditor } from "@/components/MarkdownEditor/MarkdownEditor.tsx";
import { useMonacoTheme } from "@/components/MarkdownEditor/useMonacoTheme.ts";
import { useFontSize } from "@/utils/fontScale.ts";

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

export function TicketArtifactView({ ticketId, kind }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const monacoTheme = useMonacoTheme();
  const fontSize = useFontSize("body");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const api = createBoardApi(getClient());
    api
      .readArtifact(ticketId, kind)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setStale(res.stale);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, kind]);

  return (
    <div className="ticket-artifact-view">
      <header className="ticket-artifact-header">
        <h3 className="ticket-artifact-title">
          {LABELS[kind]}
          {stale && <span className="ticket-artifact-stale">~ stale</span>}
        </h3>
      </header>
      <div className="ticket-artifact-body">
        {loading && <div className="center-placeholder">Loading…</div>}
        {!loading && content == null && (
          <div className="center-placeholder">No {LABELS[kind].toLowerCase()} on disk yet.</div>
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
