import { useCallback, useEffect, useState } from "react";
import { readFile } from "@/services/files.ts";
import { useUiStore } from "@/store/uiStore";
import { useSessionStore } from "@/store/sessionStore";
import { MarkdownPreview } from "@/components/FileViewer/MarkdownPreview";
import { modLabel } from "@/utils/platform.ts";
import "./GoalFilePanel.css";

const GOAL_FILE = "GOAL&REQUIREMENTS.md";

export function GoalFilePanel() {
  const projectPath = useUiStore((s) => s.projectPath);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const [content, setContent] = useState<string | null>(null);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;

  const fetchFile = useCallback(async () => {
    if (!projectPath) return;
    try {
      const data = await readFile(projectPath, GOAL_FILE);
      if (data?.content != null) setContent(data.content);
    } catch {
      // file doesn't exist yet — keep showing placeholder
    }
  }, [projectPath]);

  // Initial fetch
  useEffect(() => {
    fetchFile();
  }, [fetchFile]);

  // Refresh whenever a tool call completes (agent may have written the file)
  const toolCallEndCount = (activeSession?.events ?? []).filter(
    (e) => e.eventType === "toolCallEnd",
  ).length;
  useEffect(() => {
    if (toolCallEndCount > 0) fetchFile();
  }, [toolCallEndCount, fetchFile]);

  return (
    <div className="goal-file-panel">
      <div className="goal-file-panel-header">
        <button
          className="collapse-btn"
          onClick={toggleRightPanel}
          title={`Hide panel (${modLabel("J")})`}
          aria-label="Hide panel"
        >
          &#9658;
        </button>
        <span className="goal-file-panel-title">{GOAL_FILE}</span>
        {activeSession?.status === "running" && (
          <span className="goal-file-panel-badge">
            {content == null ? "generating…" : "updating…"}
          </span>
        )}
      </div>
      <div className="goal-file-panel-body">
        {content != null ? (
          <MarkdownPreview content={content} />
        ) : (
          <div className="goal-file-panel-empty">
            The file will appear here as the agent defines your goals.
          </div>
        )}
      </div>
    </div>
  );
}
