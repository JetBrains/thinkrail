import type { Link } from "@/types/spec.ts";
import type { NodePosition } from "./graphLayout.ts";
import { NODE_WIDTH, NODE_HEIGHT } from "./graphLayout.ts";

interface EdgeLayerProps {
  edges: Link[];
  positions: NodePosition[];
}

function getEdgeStyle(type: string): {
  strokeDasharray: string;
  opacity: number;
} {
  switch (type) {
    case "depends-on":
      return { strokeDasharray: "6,4", opacity: 1 };
    case "references":
      return { strokeDasharray: "3,3", opacity: 0.6 };
    default:
      return { strokeDasharray: "", opacity: 1 };
  }
}

export function EdgeLayer({ edges, positions }: EdgeLayerProps) {
  const posMap = new Map(positions.map((p) => [p.node.id, p]));

  return (
    <g className="edge-layer">
      <defs>
        <marker
          id="arrowhead"
          markerWidth={8}
          markerHeight={6}
          refX={8}
          refY={3}
          orient="auto"
        >
          <path d="M0,0 L8,3 L0,6" fill="var(--hint)" />
        </marker>
      </defs>
      {edges.map((edge, i) => {
        const from = posMap.get(edge.from);
        const to = posMap.get(edge.to);
        if (!from || !to) return null;

        const x1 = from.x + NODE_WIDTH / 2;
        const y1 = from.y + NODE_HEIGHT;
        const x2 = to.x + NODE_WIDTH / 2;
        const y2 = to.y;

        const style = getEdgeStyle(edge.type);

        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--hint)"
            strokeWidth={1.5}
            strokeDasharray={style.strokeDasharray}
            opacity={style.opacity}
            markerEnd="url(#arrowhead)"
          />
        );
      })}
    </g>
  );
}
