import { useState } from "react";
import { VisualizationCard } from "./VisualizationCard.tsx";
import {
  isPipelineTool,
  nodeMeta,
  parsePipelineNodes,
  pipelineToVisData,
} from "./pipelineToolVisualization.ts";

interface ToolInputDetailProps {
  input: Record<string, unknown>;
  toolName?: string;
}

/** Max chars before a string value is truncated with a toggle. */
const STRING_TRUNCATE = 200;

function PipelineToolInput({ input }: { input: Record<string, unknown> }) {
  const nodes = parsePipelineNodes(input);
  if (!nodes) return null;

  return (
    <div className="tool-input-pipeline">
      <VisualizationCard data={pipelineToVisData(nodes)} compactMode />
      <div className="tool-input-pipeline-list" aria-label="Pipeline stages">
        {nodes.map((node) => (
          <div key={node.id} className="tool-input-pipeline-row">
            <span className="tool-input-pipeline-id">{node.id}</span>
            <span className="tool-input-pipeline-title">{node.title}</span>
            <span className="tool-input-pipeline-meta">{nodeMeta(node)}</span>
            <span className="tool-input-pipeline-deps">
              {node.dependsOn.length > 0 ? `after ${node.dependsOn.join(", ")}` : "entry"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValueSpan({ value }: { value: unknown }) {
  const [showFull, setShowFull] = useState(false);

  if (value === null || value === undefined) {
    return <span className="tool-input-value tool-input-value--bool">null</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="tool-input-value tool-input-value--bool">
        {String(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <span className="tool-input-value tool-input-value--number">
        {String(value)}
      </span>
    );
  }
  if (typeof value === "string") {
    if (value.length > STRING_TRUNCATE && !showFull) {
      return (
        <span className="tool-input-value">
          {value.slice(0, STRING_TRUNCATE)}{"\u2026"}
          <button
            className="tool-input-toggle"
            onClick={(e) => { e.stopPropagation(); setShowFull(true); }}
          >
            show full
          </button>
        </span>
      );
    }
    return <span className="tool-input-value">{value}</span>;
  }
  // Objects / arrays — render as indented JSON
  return (
    <pre className="tool-input-value tool-input-value--nested">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * Renders a tool input object as labeled key-value pairs with type-aware coloring.
 *
 * Keys are colored gold, values are colored by type (green for strings,
 * purple for numbers, blue for booleans). Internal keys starting with `_`
 * are skipped.
 */
export function ToolInputDetail({ input, toolName }: ToolInputDetailProps) {
  const entries = Object.entries(input).filter(([k]) => !k.startsWith("_"));
  if (entries.length === 0) return null;

  if (isPipelineTool(toolName) && parsePipelineNodes(input) !== null) {
    return (
      <div className="tool-input-detail">
        <div className="tool-section-label text-uppercase">Input</div>
        <PipelineToolInput input={input} />
      </div>
    );
  }

  return (
    <div className="tool-input-detail">
      <div className="tool-section-label text-uppercase">Input</div>
      <div className="tool-input-entries">
        {entries.map(([key, value]) => (
          <div key={key} className="tool-input-kv">
            <span className="tool-input-key">{key}</span>
            <span className="tool-input-arrow">{"\u2192"}</span>
            <ValueSpan value={value} />
          </div>
        ))}
      </div>
    </div>
  );
}
