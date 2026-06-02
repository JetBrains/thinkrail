import { useCallback, useMemo, useRef, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import type { TicketSummary, TicketStatus, TicketType } from "@/types/board.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { KanbanColumn } from "./KanbanColumn.tsx";
import { TicketCard } from "./TicketCard.tsx";
import { BoardCardContextMenu } from "./BoardCardContextMenu.tsx";

const COLUMNS: { status: TicketStatus; label: string }[] = [
  { status: "idea", label: "Idea" },
  { status: "product-design", label: "Product design" },
  { status: "technical-design", label: "Technical design" },
  { status: "amend-specs", label: "Amend specs" },
  { status: "implementation-plan", label: "Implementation plan" },
  { status: "implementing", label: "Implementing" },
  { status: "done", label: "Done" },
];

const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  idea: ["product-design"],
  "product-design": ["idea", "technical-design"],
  "technical-design": ["product-design", "amend-specs"],
  "amend-specs": ["technical-design", "implementation-plan"],
  "implementation-plan": ["amend-specs", "implementing"],
  implementing: ["implementation-plan", "done"],
  done: ["implementing"],
};

function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

interface TicketBoardProps {
  tickets: TicketSummary[];
  onOpenTicket: (id: string) => void;
}

export function TicketBoard({ tickets, onOpenTicket }: TicketBoardProps) {
  const updateTicket = useBoardStore((s) => s.updateTicket);
  const deleteTicket = useBoardStore((s) => s.deleteTicket);
  const reorderTicket = useBoardStore((s) => s.reorderTicket);

  const [ctxMenu, setCtxMenu] = useState<{ ticketId: string; x: number; y: number } | null>(null);

  // Group and sort tickets by status + order
  const grouped = useMemo(() => {
    const map = new Map<TicketStatus, TicketSummary[]>();
    for (const col of COLUMNS) map.set(col.status, []);
    for (const t of tickets) {
      const list = map.get(t.status);
      if (list) list.push(t);
    }
    // Sort by order within each column
    for (const [, items] of map) {
      items.sort((a, b) => a.order - b.order);
    }
    return map;
  }, [tickets]);

  // Snapshot for cancel/revert
  const snapshot = useRef(grouped);

  const handleContextMenu = useCallback((e: React.MouseEvent, ticketId: string) => {
    setCtxMenu({ ticketId, x: e.clientX, y: e.clientY });
  }, []);

  const handleUpdateTicket = useCallback(
    async (id: string, updates: { status?: TicketStatus; type?: TicketType }) => {
      await updateTicket(id, updates);
    },
    [updateTicket],
  );

  const handleDeleteTicket = useCallback(
    async (id: string) => {
      await deleteTicket(id);
    },
    [deleteTicket],
  );

  const ctxTicket = ctxMenu ? tickets.find((t) => t.id === ctxMenu.ticketId) : null;

  return (
    <DragDropProvider
      onDragStart={() => {
        snapshot.current = grouped;
      }}
      onDragEnd={(event) => {
        if (event.canceled) return;

        const { source } = event.operation;
        if (!isSortable(source)) return;

        const { initialGroup, group, index } = source;
        if (initialGroup == null || group == null || index == null) return;

        const fromStatus = initialGroup as TicketStatus;
        const toStatus = group as TicketStatus;

        // Validate state machine transition
        if (!canTransition(fromStatus, toStatus)) return;

        const ticketId = String(source.id);
        reorderTicket(ticketId, toStatus, index);
      }}
    >
      <div className="kanban-columns">
        {COLUMNS.map((col) => {
          const items = grouped.get(col.status) ?? [];
          return (
            <KanbanColumn key={col.status} id={col.status} title={col.label} count={items.length}>
              {items.map((t, index) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  index={index}
                  column={col.status}
                  onOpen={onOpenTicket}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </KanbanColumn>
          );
        })}

        {ctxMenu && ctxTicket && (
          <BoardCardContextMenu
            ticket={ctxTicket}
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            onOpen={onOpenTicket}
            onUpdateTicket={handleUpdateTicket}
            onDeleteTicket={handleDeleteTicket}
          />
        )}
      </div>
    </DragDropProvider>
  );
}
