import { useMemo } from "react";
import type { MetaTicketSummary, MetaTicketStatus } from "@/types/board.ts";
import { KanbanColumn } from "./KanbanColumn.tsx";
import { MetaTicketCard } from "./MetaTicketCard.tsx";

const COLUMNS: { status: MetaTicketStatus; label: string }[] = [
  { status: "idea", label: "Idea" },
  { status: "specified", label: "Specified" },
  { status: "planned", label: "Planned" },
  { status: "executing", label: "Executing" },
  { status: "done", label: "Done" },
];

interface MetaTicketBoardProps {
  tickets: MetaTicketSummary[];
  onOpenTicket: (id: string) => void;
}

export function MetaTicketBoard({ tickets, onOpenTicket }: MetaTicketBoardProps) {
  const grouped = useMemo(() => {
    const map = new Map<MetaTicketStatus, MetaTicketSummary[]>();
    for (const col of COLUMNS) map.set(col.status, []);
    for (const t of tickets) {
      const list = map.get(t.status);
      if (list) list.push(t);
    }
    return map;
  }, [tickets]);

  return (
    <div className="kanban-columns">
      {COLUMNS.map((col) => {
        const items = grouped.get(col.status) ?? [];
        return (
          <KanbanColumn key={col.status} title={col.label} count={items.length}>
            {items.map((t) => (
              <MetaTicketCard key={t.id} ticket={t} onOpen={onOpenTicket} />
            ))}
          </KanbanColumn>
        );
      })}
    </div>
  );
}
