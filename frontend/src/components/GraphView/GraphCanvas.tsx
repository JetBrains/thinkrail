import type { SpecEntry, Link } from "@/types/spec.ts";
import type { NodePosition, Transform } from "./graphLayout.ts";
import { GraphNode } from "./GraphNode.tsx";
import { EdgeLayer } from "./EdgeLayer.tsx";

interface GraphCanvasProps {
  positions: NodePosition[];
  edges: Link[];
  selectedId: string | null;
  transform: Transform;
  onNodeClick: (node: SpecEntry) => void;
  onNodeDoubleClick: (node: SpecEntry) => void;
}

export function GraphCanvas({
  positions,
  edges,
  selectedId,
  transform,
  onNodeClick,
  onNodeDoubleClick,
}: GraphCanvasProps) {
  return (
    <svg className="graph-canvas" width="100%" height="100%">
      <g
        transform={`translate(${transform.translateX},${transform.translateY}) scale(${transform.scale})`}
      >
        <EdgeLayer edges={edges} positions={positions} />
        {positions.map((pos) => (
          <GraphNode
            key={pos.node.id}
            node={pos.node}
            x={pos.x}
            y={pos.y}
            selected={pos.node.id === selectedId}
            onClick={() => onNodeClick(pos.node)}
            onDoubleClick={() => onNodeDoubleClick(pos.node)}
          />
        ))}
      </g>
    </svg>
  );
}
