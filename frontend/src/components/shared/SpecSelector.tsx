import { useMemo, useState } from "react";
import { useSpecStore } from "@/store/specStore.ts";
import "./SpecSelector.css";

interface SpecSelectorProps {
  selectedIds: string[];
  onToggle: (id: string) => void;
}

export function SpecSelector({ selectedIds, onToggle }: SpecSelectorProps) {
  const specs = useSpecStore((s) => s.specs);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return specs;
    const q = search.toLowerCase();
    return specs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }, [specs, search]);

  const selected = specs.filter((s) => selectedIds.includes(s.id));

  return (
    <div className="spec-selector">
      <div className="spec-selector-chips">
        {selected.map((s) => (
          <span key={s.id} className="spec-chip">
            {s.title}
            <button
              className="spec-chip-remove"
              onClick={() => onToggle(s.id)}
            >
              {"\u00D7"}
            </button>
          </span>
        ))}
        <button
          className="spec-selector-add"
          onClick={() => setOpen(!open)}
        >
          + Add spec
        </button>
      </div>
      {open && (
        <div className="spec-selector-dropdown">
          <input
            className="spec-selector-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search specs..."
            autoFocus
          />
          <div className="spec-selector-list">
            {filtered.map((s) => (
              <button
                key={s.id}
                className={`spec-selector-item ${selectedIds.includes(s.id) ? "spec-selector-item-selected" : ""}`}
                onClick={() => {
                  onToggle(s.id);
                }}
              >
                <span className="spec-selector-item-title">{s.title}</span>
                <span className="spec-selector-item-type">{s.type}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="spec-selector-empty">No specs found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
