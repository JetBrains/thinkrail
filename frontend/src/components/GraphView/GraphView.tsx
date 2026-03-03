import { useCallback, useMemo, useRef, useState } from "react";
import { useSpecStore } from "@/store/specStore.ts";
import type { RegistryEntry } from "@/types/spec.ts";
import {
  computeLayer,
  fitToView,
  getStructuralChildren,
  layoutNodes,
  type Transform,
} from "./graphLayout.ts";
import { GraphCanvas } from "./GraphCanvas.tsx";
import { GraphBreadcrumb } from "./GraphBreadcrumb.tsx";
import { GraphControls } from "./GraphControls.tsx";
import { GraphLegend } from "./GraphLegend.tsx";
import "./GraphView.css";

export function GraphView() {
  const graph = useSpecStore((s) => s.graph);
  const selectSpec = useSpecStore((s) => s.selectSpec);
  const selectedSpecId = useSpecStore((s) => s.selectedSpecId);
  const containerRef = useRef<HTMLDivElement>(null);

  const [rootId, setRootId] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const layer = useMemo(
    () => (graph ? computeLayer(graph, rootId) : null),
    [graph, rootId],
  );

  const positions = useMemo(() => {
    if (!layer) return [];
    const width = containerRef.current?.clientWidth ?? 600;
    return layoutNodes(layer.children, width);
  }, [layer]);

  const handleNodeClick = useCallback(
    (node: RegistryEntry) => {
      if (!graph) return;
      const children = getStructuralChildren(graph, node.id);
      if (children.length > 0) {
        setRootId(node.id);
      } else {
        selectSpec(node.id);
      }
    },
    [graph, selectSpec],
  );

  const handleNodeDoubleClick = useCallback(
    (node: RegistryEntry) => {
      selectSpec(node.id);
    },
    [selectSpec],
  );

  const handleNavigate = useCallback((nodeId: string | null) => {
    setRootId(nodeId);
  }, []);

  const handleFit = useCallback(() => {
    const el = containerRef.current;
    if (!el || positions.length === 0) return;
    setTransform(fitToView(positions, el.clientWidth, el.clientHeight));
  }, [positions]);

  const handleZoomIn = useCallback(() => {
    setTransform((t) => ({
      ...t,
      scale: Math.min(2.0, t.scale * 1.2),
    }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform((t) => ({
      ...t,
      scale: Math.max(0.3, t.scale / 1.2),
    }));
  }, []);

  if (!graph) {
    return (
      <div className="graph-empty">
        <div className="graph-empty-text">No specs found</div>
      </div>
    );
  }

  return (
    <div className="graph-view" ref={containerRef}>
      {layer && layer.breadcrumb.length > 0 && (
        <GraphBreadcrumb trail={layer.breadcrumb} onNavigate={handleNavigate} />
      )}
      <GraphCanvas
        positions={positions}
        edges={layer?.intraEdges ?? []}
        selectedId={selectedSpecId}
        transform={transform}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
      />
      <GraphControls
        zoom={transform.scale}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
      />
      <GraphLegend />
    </div>
  );
}
