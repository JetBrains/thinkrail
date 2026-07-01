import { useState } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useTicketRouteStore } from "@/store/ticketRouteStore.ts";
import { deriveSessionTodoState } from "./sessionTodoState.ts";
import { deriveLiveActivity } from "@/hooks/useTaskSnapshot.ts";
import { TaskActivityLine } from "@/components/ChatStream/TaskActivityLine.tsx";
import type { SessionArtifact } from "@/types/agent.ts";

const TODO_STATUS_GLYPH: Record<string, string> = {
  completed: "✓",
  in_progress: "●",
  pending: "○",
};

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function RailSegments({ depth, ancestors }: {
  depth: number;
  ancestors: boolean[];
}) {
  const segments = [];
  for (let i = 0; i < depth; i++) {
    const hasMore = ancestors[i] ?? false;
    if (i === depth - 1) {
      segments.push(
        <span
          key={i}
          className="stage-rail-segment stage-rail-segment--elbow"
          aria-hidden="true"
        />,
      );
    } else {
      segments.push(
        <span
          key={i}
          className={`stage-rail-segment${hasMore ? " stage-rail-segment--branch" : ""}`}
          aria-hidden="true"
        />,
      );
    }
  }
  return <span className="stage-row-rail">{segments}</span>;
}

export function SessionSubRow({
  sid,
  depth,
  ancestors,
  isActive,
  onFocusSession,
  onOpenFile,
}: {
  sid: string;
  depth: number;
  ancestors: boolean[];
  isActive: boolean;
  onFocusSession: (sid: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const session = useSessionStore((s) => s.sessions.get(sid));
  const summary = useTicketRouteStore((s) => s.sessionSummaries.get(sid));

  const liveSnapshot = deriveSessionTodoState(session?.events ?? []);
  const todos = liveSnapshot?.todos ?? summary?.todos ?? [];

  const activity = isActive ? deriveLiveActivity(session?.events ?? []) : null;

  const artifactPaths = new Set<string>();
  const artifactList: SessionArtifact[] = [];
  for (const a of session?.artifacts ?? []) {
    if (!artifactPaths.has(a.path)) {
      artifactPaths.add(a.path);
      artifactList.push(a);
    }
  }
  const previewPath = session?.previewPath ?? null;
  if (previewPath && !artifactPaths.has(previewPath)) {
    artifactPaths.add(previewPath);
    artifactList.push({ path: previewPath } as SessionArtifact);
  }

  const hasContent = todos.length > 0 || artifactList.length > 0;
  const doneCount = todos.filter((t) => t.status === "completed").length;
  const totalCount = todos.length;

  const childAncestors = [...ancestors, false];

  return (
    <>
      <div
        className={`stage-row stage-sub-row${isActive ? " stage-sub-row--active" : ""}`}
      >
        <RailSegments depth={depth} ancestors={ancestors} />
        <span
          className="stage-chevron"
          onClick={hasContent ? (e) => { e.stopPropagation(); setExpanded((v) => !v); } : undefined}
          style={{ visibility: hasContent ? "visible" : "hidden" }}
          aria-hidden="true"
        >
          {expanded ? "▾" : "▸"}
        </span>
        <span className="stage-icon">{"▷"}</span>
        <span
          className="stage-title"
          onClick={(e) => { e.stopPropagation(); onFocusSession(sid); }}
        >
          {"session " + sid.slice(0, 8)}
        </span>
        {todos.length > 0 && (
          <span className="stage-session-count">{doneCount}/{totalCount}</span>
        )}
        {activity && (
          <span className="stage-session-activity"><TaskActivityLine activity={activity} /></span>
        )}
      </div>
      {expanded && hasContent && (
        <div className="stage-sub-rows">
          {todos.map((todo) => (
            <div key={todo.key} className="stage-row stage-sub-row stage-session-todo-row">
              <RailSegments depth={depth + 1} ancestors={childAncestors} />
              <span className="stage-chevron" style={{ visibility: "hidden" }}>▸</span>
              <span className="stage-icon stage-session-todo-glyph">
                {TODO_STATUS_GLYPH[todo.status] ?? "○"}
              </span>
              <span className="stage-title stage-session-todo-content">{todo.content}</span>
            </div>
          ))}
          {artifactList.map((a) => (
            <div
              key={a.path}
              className="stage-row stage-sub-row stage-session-file-row"
              onClick={(e) => { e.stopPropagation(); onOpenFile(a.path); }}
            >
              <RailSegments depth={depth + 1} ancestors={childAncestors} />
              <span className="stage-chevron" style={{ visibility: "hidden" }}>▸</span>
              <span className="stage-icon">{"📄"}</span>
              <span className="stage-title">{basename(a.path)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
