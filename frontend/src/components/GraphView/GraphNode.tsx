import type { SpecEntry } from "@/types/spec.ts";
import { NODE_WIDTH, NODE_HEIGHT } from "./graphLayout.ts";

const TYPE_COLORS: Record<string, string> = {
  "goal-and-requirements": "var(--gold)",
  "architecture-design": "var(--purple)",
  "module-design": "var(--blue)",
  "submodule-design": "var(--blue)",
  "task-spec": "var(--green)",
};

const STATUS_BORDERS: Record<string, string> = {
  done: "var(--green)",
  active: "var(--blue)",
  pending: "var(--hint)",
  stale: "var(--red)",
  draft: "var(--hint)",
};

const TYPE_ICONS: Record<string, string> = {
  "goal-and-requirements": "\u{1F3AF}",
  "architecture-design": "\u{1F3DB}",
  "module-design": "\u{1F4E6}",
  "submodule-design": "\u{1F4E6}",
  "task-spec": "\u{1F4CB}",
};

interface GraphNodeProps {
  node: SpecEntry;
  x: number;
  y: number;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

export function GraphNode({
  node,
  x,
  y,
  selected,
  onClick,
  onDoubleClick,
}: GraphNodeProps) {
  const color = TYPE_COLORS[node.type] ?? "var(--hint)";
  const border = STATUS_BORDERS[node.status] ?? "var(--hint)";
  const icon = TYPE_ICONS[node.type] ?? "";

  return (
    <g
      className="graph-node"
      transform={`translate(${x},${y})`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ cursor: "pointer" }}
    >
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={6}
        fill="var(--elevated)"
        stroke={selected ? "var(--blue)" : border}
        strokeWidth={selected ? 2 : 1.5}
      />
      <line x1={0} y1={0} x2={0} y2={NODE_HEIGHT} stroke={color} strokeWidth={3} />
      <text
        x={12}
        y={NODE_HEIGHT / 2}
        dominantBaseline="central"
        fill="var(--text)"
        fontSize={11}
        fontFamily="var(--font)"
      >
        {icon} {node.title.length > 16 ? node.title.slice(0, 15) + "\u2026" : node.title}
      </text>
    </g>
  );
}
