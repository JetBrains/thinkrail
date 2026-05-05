import { useMemo, useState } from "react";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { useSelectedSpec } from "../useSelectedSpec.ts";
import { useSpecStore } from "@/store/specStore.ts";
import type { SpecEntry } from "@/types/spec.ts";
import { GraphModal } from "@/components/GraphView/GraphModal.tsx";
import "./ConnectedSpecs.css";

interface LinkGroup {
  label: string;
  entries: SpecEntry[];
}

const GROUP_ORDER = ["Parent", "Children", "Implements", "Depends on", "Depended by", "References", "Referenced by"];

export function ConnectedSpecs() {
  const spec = useSelectedSpec();
  const graph = useSpecStore((s) => s.graph);
  const selectSpec = useSpecStore((s) => s.selectSpec);
  const [graphOpen, setGraphOpen] = useState(false);

  const groups = useMemo<LinkGroup[]>(() => {
    if (!spec || !graph) return [];
    const specId = spec.id;
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    const grouped = new Map<string, SpecEntry[]>();

    for (const edge of graph.edges) {
      let groupLabel: string;
      let otherId: string;

      if (edge.from === specId) {
        otherId = edge.to;
        if (edge.type === "parent") groupLabel = "Parent";
        else if (edge.type === "implements") groupLabel = "Implements";
        else if (edge.type === "depends-on") groupLabel = "Depends on";
        else if (edge.type === "references") groupLabel = "References";
        else groupLabel = edge.type;
      } else if (edge.to === specId) {
        otherId = edge.from;
        if (edge.type === "parent") groupLabel = "Children";
        else if (edge.type === "implements") groupLabel = "Implemented by";
        else if (edge.type === "depends-on") groupLabel = "Depended by";
        else if (edge.type === "references") groupLabel = "Referenced by";
        else groupLabel = edge.type;
      } else {
        continue;
      }

      const node = nodeMap.get(otherId);
      if (!node) continue;

      const list = grouped.get(groupLabel) ?? [];
      list.push(node);
      grouped.set(groupLabel, list);
    }

    return GROUP_ORDER
      .filter((label) => grouped.has(label))
      .map((label) => ({ label, entries: grouped.get(label)! }));
  }, [spec, graph]);

  const totalCount = groups.reduce((sum, g) => sum + g.entries.length, 0);

  return (
    <>
      {graphOpen && <GraphModal onClose={() => setGraphOpen(false)} />}
    <CollapsibleSection
      title="Connected Specs"
      count={totalCount || undefined}
      expandToCenter={() => setGraphOpen(true)}
    >
      {groups.length === 0 ? (
        <div className="section-placeholder">No linked specs found</div>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="connected-group">
            <div className="connected-group__label">
              {group.label} ({group.entries.length})
            </div>
            {group.entries.map((entry) => (
              <button
                key={entry.id}
                className="connected-item"
                onClick={() => selectSpec(entry.id)}
              >
                {entry.title}
              </button>
            ))}
          </div>
        ))
      )}
    </CollapsibleSection>
    </>
  );
}
