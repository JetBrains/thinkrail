import { useState, useEffect } from "react";
import type { TicketState } from "@/types/rpc-methods.ts";
import { NodeStatus } from "@/constants/status.ts";
import { SessionSubRow } from "./SessionSubRow.tsx";
import "./StageGraph.css";

type WorkNode = NonNullable<TicketState["stages"]>[number];
type Run = NonNullable<WorkNode["runs"]>[number];

const STATUS_ICON: Record<string, string> = {
  [NodeStatus.Pending]: "○", [NodeStatus.Running]: "●", [NodeStatus.Done]: "✓", [NodeStatus.Failed]: "✕",
};

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
          className={`stage-rail-segment stage-rail-segment--elbow`}
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

function NodeRow({
  node, depth, isLast, ancestors, onFocusNode, onCompleteNode, onRefineNode, onSelectArtifact,
  onFocusSession, onOpenFile,
}: {
  node: WorkNode;
  depth: number;
  isLast: boolean;
  ancestors: boolean[];
  onFocusNode: (id: string) => void;
  onCompleteNode?: (id: string) => void;
  onRefineNode?: (id: string) => void;
  onSelectArtifact?: (artifactKind: string) => void;
  onFocusSession?: (sid: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const status = node.status ?? NodeStatus.Pending;
  const runs = node.runs ?? [];
  const children = node.children ?? [];
  const isExpandable = !!(node.artifactKind || runs.length > 0 || children.length > 0);
  const [expanded, setExpanded] = useState(() => status === NodeStatus.Running);

  useEffect(() => {
    setExpanded(status === NodeStatus.Running);
  }, [status]);

  const childAncestors = [...ancestors, !isLast];

  return (
    <>
      <div
        className={`stage-row stage-${status}`}
        onClick={() => onFocusNode(node.id)}
      >
        {depth > 0 && <RailSegments depth={depth} ancestors={ancestors} />}
        <span
          className="stage-chevron"
          onClick={isExpandable ? (e) => { e.stopPropagation(); setExpanded((v) => !v); } : undefined}
          style={{ visibility: isExpandable ? "visible" : "hidden" }}
          aria-hidden="true"
        >
          {expanded ? "▾" : "▸"}
        </span>
        <span className="stage-icon">{STATUS_ICON[status] ?? "○"}</span>
        <span className="stage-title">{node.title}</span>
        <span className="stage-actions">
          {status === NodeStatus.Running && onCompleteNode && (
            <button
              className="stage-icon-btn"
              title="Force complete stage"
              aria-label="force complete stage"
              onClick={(e) => { e.stopPropagation(); onCompleteNode(node.id); }}
            >
              {"✓"}
            </button>
          )}
          {status === NodeStatus.Done && onRefineNode && (
            <button
              className="stage-icon-btn"
              title="Refine (new stage)"
              aria-label="refine stage"
              onClick={(e) => { e.stopPropagation(); onRefineNode(node.id); }}
            >
              {"⟳"}
            </button>
          )}
          {status === NodeStatus.Running && (
            <span className="stage-live-dot" aria-hidden="true" />
          )}
          <span className="stage-status">{status}</span>
        </span>
      </div>
      {expanded && (
        <div className="stage-sub-rows">
          {node.artifactKind && typeof node.artifactKind === "string" && (
            <div
              className="stage-row stage-sub-row"
              onClick={(e) => { e.stopPropagation(); onSelectArtifact?.(node.artifactKind as string); }}
            >
              <RailSegments depth={depth + 1} ancestors={childAncestors} />
              <span className="stage-chevron" style={{ visibility: "hidden" }}>▸</span>
              <span className="stage-icon">{"📄"}</span>
              <span className="stage-title">{(node.artifactKind as string).replace(/_/g, " ")}</span>
            </div>
          )}
          {runs.map((run: Run, idx) => {
            const sid = run.sessionId ?? run.orchestratorSid ?? "";
            const isActiveRun = status === NodeStatus.Running && idx === runs.length - 1;
            return (
              <SessionSubRow
                key={sid}
                sid={sid}
                depth={depth + 1}
                ancestors={childAncestors}
                isActive={isActiveRun}
                onFocusSession={onFocusSession ?? (() => {})}
                onOpenFile={onOpenFile ?? (() => {})}
              />
            );
          })}
          {children.map((child, idx) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              isLast={idx === children.length - 1}
              ancestors={childAncestors}
              onFocusNode={onFocusNode}
              onCompleteNode={onCompleteNode}
              onRefineNode={onRefineNode}
              onSelectArtifact={onSelectArtifact}
              onFocusSession={onFocusSession}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function StageGraph({
  state, onFocusNode, onCompleteNode, onRefineNode, onSelectArtifact, onFocusSession, onOpenFile,
}: {
  state: TicketState;
  onFocusNode: (id: string) => void;
  onCompleteNode?: (id: string) => void;
  onRefineNode?: (id: string) => void;
  onSelectArtifact?: (artifactKind: string) => void;
  onFocusSession?: (sid: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const stages = state.stages ?? [];
  return (
    <div className="stage-graph">
      <div className="stage-tree">
        {stages.map((n, idx) => (
          <NodeRow
            key={n.id}
            node={n}
            depth={0}
            isLast={idx === stages.length - 1}
            ancestors={[]}
            onFocusNode={onFocusNode}
            onCompleteNode={onCompleteNode}
            onRefineNode={onRefineNode}
            onSelectArtifact={onSelectArtifact}
            onFocusSession={onFocusSession}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  );
}
