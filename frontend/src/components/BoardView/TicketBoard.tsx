import { useCallback, useMemo, useRef, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import type { Lifecycle, TicketSummary, TicketType } from "@/types/board.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { KanbanColumn } from "./KanbanColumn.tsx";
import { TicketCard } from "./TicketCard.tsx";
import { BoardCardContextMenu } from "./BoardCardContextMenu.tsx";

const COLUMNS: { lifecycle: Lifecycle; label: string }[] = [
  { lifecycle: "created", label: "Created" },
  { lifecycle: "design", label: "Design" },
  { lifecycle: "implementation", label: "Implementation" },
  { lifecycle: "done", label: "Done" },
];

interface TicketBoardProps {
  tickets: TicketSummary[];
  onOpenTicket: (id: string) => void;
  onPreviewTicket: (id: string) => void;
}

export function TicketBoard({ tickets, onOpenTicket, onPreviewTicket }: TicketBoardProps) {
  const updateTicket = useBoardStore((s) => s.updateTicket);
  const deleteTicket = useBoardStore((s) => s.deleteTicket);
  const reorderTicket = useBoardStore((s) => s.reorderTicket);

  const [ctxMenu, setCtxMenu] = useState<{ ticketId: string; x: number; y: number } | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<Lifecycle, TicketSummary[]>();
    for (const col of COLUMNS) map.set(col.lifecycle, []);
    for (const t of tickets) {
      const list = map.get(t.lifecycle);
      if (list) list.push(t);
    }
    for (const [, items] of map) {
      items.sort((a, b) => a.order - b.order);
    }
    return map;
  }, [tickets]);

  const snapshot = useRef(grouped);

  const handleContextMenu = useCallback((e: React.MouseEvent, ticketId: string) => {
    setCtxMenu({ ticketId, x: e.clientX, y: e.clientY });
  }, []);

  const handleUpdateTicket = useCallback(
    async (id: string, updates: { type?: TicketType }) => {
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

        const { index } = source;
        if (index == null) return;

        const ticketId = String(source.id);
        reorderTicket(ticketId, index);
      }}
    >
      <div className="kanban-columns">
        {COLUMNS.map((col) => {
          const items = grouped.get(col.lifecycle) ?? [];
          return (
            <KanbanColumn key={col.lifecycle} id={col.lifecycle} title={col.label} count={items.length}>
              {items.map((t, index) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  index={index}
                  column={col.lifecycle}
                  onOpen={onOpenTicket}
                  onPreview={onPreviewTicket}
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
