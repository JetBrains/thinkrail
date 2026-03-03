import type { RegistryEntry } from "@/types/spec.ts";

interface GraphBreadcrumbProps {
  trail: RegistryEntry[];
  onNavigate: (nodeId: string | null) => void;
}

export function GraphBreadcrumb({ trail, onNavigate }: GraphBreadcrumbProps) {
  if (trail.length === 0) return null;

  return (
    <div className="graph-breadcrumb">
      <button
        className="graph-breadcrumb-back"
        onClick={() => {
          if (trail.length >= 2) {
            onNavigate(trail[trail.length - 2].id);
          } else {
            onNavigate(null);
          }
        }}
        title="Go up one level"
      >
        {"\u2190"}
      </button>
      {trail.map((node, i) => (
        <span key={node.id}>
          {i > 0 && <span className="graph-breadcrumb-sep">{"\u203A"}</span>}
          {i < trail.length - 1 ? (
            <button
              className="graph-breadcrumb-item"
              onClick={() => onNavigate(node.id)}
            >
              {node.title}
            </button>
          ) : (
            <span className="graph-breadcrumb-current">{node.title}</span>
          )}
        </span>
      ))}
    </div>
  );
}
