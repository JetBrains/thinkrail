import { useState } from "react";
import type { TaskSnapshot } from "@/hooks/useTaskSnapshot.ts";
import { TaskChecklist } from "./TaskChecklist.tsx";
import { TaskActivityLine } from "./TaskActivityLine.tsx";
import "./TaskTracker.css";

export function shouldShowDockedBar(
  { running, total, anchorVisible }: { running: boolean; total: number; anchorVisible: boolean },
): boolean {
  return running && total > 0 && !anchorVisible;
}

export function TaskDockedBar({ snapshot }: { snapshot: TaskSnapshot }) {
  const [open, setOpen] = useState(false);
  const items = snapshot.items.map((i) => ({ key: i.key, label: i.content, status: i.status }));
  return (
    <>
      <div className="task-dock" onClick={() => setOpen((v) => !v)}>
        <span className="task-dock__spinner" aria-hidden="true" />
        <span className="task-dock__count">{snapshot.done} / {snapshot.total}</span>
        <TaskActivityLine activity={snapshot.activity} />
        <button
          className="task-dock__open"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        >
          full list
        </button>
      </div>
      {open && (
        <div className="task-dock-pop">
          <div className="task-dock-pop__header">
            <span className="task-dock-pop__title">Tasks</span>
            <span className="task-dock-pop__count">{snapshot.done} / {snapshot.total}</span>
          </div>
          <TaskActivityLine activity={snapshot.activity} />
          <TaskChecklist items={items} />
        </div>
      )}
    </>
  );
}
