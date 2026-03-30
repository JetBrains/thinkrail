import { useMemo, useState } from "react";
import { useBoardStore } from "@/store/boardStore.ts";
import "./TicketSelector.css";

interface TicketSelectorProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function TicketSelector({ selectedId, onSelect }: TicketSelectorProps) {
  const tickets = useBoardStore((s) => s.tickets);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const all = Array.from(tickets.values());
    if (!search) return all;
    const q = search.toLowerCase();
    return all.filter((t) => t.title.toLowerCase().includes(q));
  }, [tickets, search]);

  return (
    <div className="ticket-selector">
      <input
        className="ticket-selector-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search tickets..."
        autoFocus
      />
      <div className="ticket-selector-list">
        {filtered.map((t) => (
          <button
            key={t.id}
            className={`ticket-selector-item ${selectedId === t.id ? "ticket-selector-item-selected" : ""}`}
            onClick={() => onSelect(selectedId === t.id ? null : t.id)}
          >
            <span className="ticket-selector-item-title">{t.title}</span>
            <span className="ticket-selector-item-meta">
              <span className={`ticket-selector-status ticket-selector-status--${t.status}`}>{t.status}</span>
              <span className="ticket-selector-type">{t.type}</span>
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="ticket-selector-empty">No tickets found</div>
        )}
      </div>
    </div>
  );
}
