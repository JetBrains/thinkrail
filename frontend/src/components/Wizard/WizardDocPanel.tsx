import { useCallback, useEffect, useMemo, useState } from "react";
import { SessionStatus } from "@/constants/status.ts";
import { EventType } from "@/constants/eventTypes.ts";
import { readFile } from "@/services/files.ts";
import { useUiStore } from "@/store/uiStore";
import { useSessionStore } from "@/store/sessionStore";
import { MarkdownPreview } from "@/components/FileViewer/MarkdownPreview";
import { artifactPathCandidates } from "./registry";
import "./WizardDocPanel.css";

interface WizardDocPanelProps {
  /** Project-relative path to the live document. */
  filePath: string;
}

export function WizardDocPanel({ filePath }: WizardDocPanelProps) {
  const projectPath = useUiStore((s) => s.projectPath);
  const [content, setContent] = useState<string | null>(null);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;

  // Tolerate skills that hand us either the root path or `.tr/`-
  // prefixed path. Memoised so `fetchFile`'s deps stay honest.
  const candidates = useMemo(() => artifactPathCandidates(filePath), [filePath]);

  const fetchFile = useCallback(async () => {
    if (!projectPath) return;
    for (const candidate of candidates) {
      try {
        const data = await readFile(projectPath, candidate);
        if (data?.content != null) {
          setContent(data.content);
          return;
        }
      } catch {
        // try next candidate
      }
    }
    // none of the candidates resolved — keep showing the placeholder
  }, [projectPath, candidates]);

  // Reset content when the file changes (e.g., switching wizard sessions)
  useEffect(() => {
    setContent(null);
  }, [filePath]);

  // Initial fetch
  useEffect(() => {
    fetchFile();
  }, [fetchFile]);

  // Refresh whenever a tool call completes (agent may have written the file)
  const toolCallEndCount = (activeSession?.events ?? []).filter(
    (e) => e.eventType === EventType.ToolCallEnd,
  ).length;
  useEffect(() => {
    if (toolCallEndCount > 0) fetchFile();
  }, [toolCallEndCount, fetchFile]);

  return (
    <div className="wiz-doc-panel">
      <div className="wiz-doc-panel-header">
        <span className="wiz-doc-panel-title">{filePath.replace(/^\.tr\//, "")}</span>
        {activeSession?.status === SessionStatus.Running && (
          <span className="wiz-doc-panel-badge">
            {content == null ? "generating…" : "updating…"}
          </span>
        )}
      </div>
      <div className="wiz-doc-panel-body">
        {content != null ? (
          <MarkdownPreview content={content} />
        ) : (
          <div className="wiz-doc-panel-empty">
            The file will appear here as the agent works on it.
          </div>
        )}
      </div>
    </div>
  );
}
