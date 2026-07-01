import type { TaskSnapshot } from "@/hooks/useTaskSnapshot.ts";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { TaskChecklist } from "@/components/ChatStream/TaskChecklist.tsx";
import { TaskActivityLine } from "@/components/ChatStream/TaskActivityLine.tsx";

export function TasksSection({ snapshot }: { snapshot: TaskSnapshot }) {
  if (snapshot.total === 0) return null;
  const items = snapshot.items.map((i) => ({ key: i.key, label: i.content, status: i.status }));
  const inProgress = snapshot.items.find((i) => i.status === "in_progress");
  const summary = inProgress ? `${snapshot.done}/${snapshot.total} · ${inProgress.content}` : `${snapshot.done}/${snapshot.total}`;
  return (
    <CollapsibleSection title="Tasks" count={snapshot.total} defaultExpanded summary={summary}>
      <TaskActivityLine activity={snapshot.activity} />
      <TaskChecklist items={items} />
    </CollapsibleSection>
  );
}
