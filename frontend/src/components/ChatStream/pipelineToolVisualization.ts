import type { VisData } from "@/types/vis.ts";

export type PipelineNodeInput = {
  id: string;
  title: string;
  skill?: string;
  dependsOn: string[];
  executesPlan?: boolean;
  artifactKind?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parsePipelineNodes(input: Record<string, unknown>): PipelineNodeInput[] | null {
  if (!Array.isArray(input.nodes)) return null;

  const nodes = input.nodes.flatMap((item): PipelineNodeInput[] => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    if (!id) return [];
    return [{
      id,
      title: stringValue(item.title) ?? id,
      skill: stringValue(item.skill),
      dependsOn: stringArrayValue(item.dependsOn ?? item.depends_on),
      executesPlan: boolValue(item.executesPlan ?? item.executes_plan),
      artifactKind: stringValue(item.artifactKind ?? item.artifact_kind),
    }];
  });

  return nodes.length > 0 ? nodes : null;
}

export function isPipelineTool(toolName?: string): boolean {
  return toolName === "propose_pipeline";
}

export function shouldRenderToolInputDetail(
  toolName: string | undefined,
  input: Record<string, unknown>,
): boolean {
  const visibleKeys = Object.keys(input).filter((key) => !key.startsWith("_"));
  return visibleKeys.length > 1 || (isPipelineTool(toolName) && parsePipelineNodes(input) !== null);
}

function safeMermaidId(id: string, index: number): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([^a-zA-Z_])/, "_$1");
  return `n${index}_${cleaned || "node"}`;
}

function escapeMermaidLabelPart(label: string): string {
  return label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "#quot;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;");
}

export function nodeMeta(node: PipelineNodeInput): string {
  if (node.executesPlan) return "implementation";
  return node.artifactKind ?? node.skill ?? "stage";
}

export function pipelineToVisData(nodes: PipelineNodeInput[]): VisData {
  const idMap = new Map(nodes.map((node, index) => [node.id, safeMermaidId(node.id, index)]));
  const lines = ["graph LR"];

  for (const node of nodes) {
    const mermaidId = idMap.get(node.id);
    if (!mermaidId) continue;
    const meta = nodeMeta(node);
    const label = `${escapeMermaidLabelPart(node.title)}<br/>${escapeMermaidLabelPart(meta)}`;
    lines.push(`  ${mermaidId}["${label}"]`);
  }

  for (const node of nodes) {
    const to = idMap.get(node.id);
    if (!to) continue;
    for (const depId of node.dependsOn) {
      const from = idMap.get(depId);
      if (from) lines.push(`  ${from} --> ${to}`);
    }
  }

  return {
    type: "diagram",
    title: "Pipeline proposal",
    layout: { width: "wide", maxHeight: 360 },
    data: { diagram: lines.join("\n"), notation: "mermaid" },
  };
}
