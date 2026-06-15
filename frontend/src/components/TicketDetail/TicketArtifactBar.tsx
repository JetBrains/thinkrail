import { useState } from "react";
import { ChevronDown, Maximize2, Minimize2 } from "lucide-react";
import "./ImplementationCards.css";

export interface ArtifactEntry {
  id: string;
  icon: React.ReactNode;
  label: string;
  live: boolean;
}

interface Props {
  entries: ArtifactEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: (collapsed: boolean) => void;
}

export function TicketArtifactBar(props: Props) {
  const { entries, selectedId, onSelect, collapsed, onToggleCollapsed } = props;
  const active = entries.find((e) => e.id === selectedId) ?? entries[0] ?? null;
  const [dropdownOpen, setDropdownOpen] = useState(false);

  if (collapsed) {
    return (
      <div className="tab-bar tab-bar--collapsed">
        {active && (
          <>
            <span className="tab-bar__icon">{active.icon}</span>
            <span className="tab-bar__name">{active.label}</span>
            {active.live && <span className="tab-bar__live">live</span>}
          </>
        )}
        <span className="tab-bar__count">{entries.length} artifacts</span>
        <button
          className="tab-bar__btn"
          title="Show all artifacts"
          onClick={() => setDropdownOpen((v) => !v)}
        >
          <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          className="tab-bar__btn"
          title="Expand"
          onClick={() => onToggleCollapsed(false)}
        >
          <Maximize2 size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {dropdownOpen && (
          <div className="tab-bar__dropdown">
            {entries.map((e) => (
              <div
                key={e.id}
                className={
                  "tab-bar__dropdown-row" +
                  (e.id === selectedId ? " tab-bar__dropdown-row--sel" : "")
                }
                onClick={() => {
                  onSelect(e.id);
                  setDropdownOpen(false);
                }}
              >
                <span>{e.icon}</span>
                <span>{e.label}</span>
                {e.live && <span className="tab-bar__live">live</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tab-bar tab-bar--tabs">
      <div className="tab-bar__tabs">
        {entries.map((e) => (
          <div
            key={e.id}
            className={
              "tab-bar__tab" + (e.id === selectedId ? " tab-bar__tab--active" : "")
            }
            onClick={() => onSelect(e.id)}
          >
            <span className="tab-bar__icon">{e.icon}</span>
            <span className="tab-bar__name">{e.label}</span>
            {e.live && <span className="tab-bar__live">●</span>}
          </div>
        ))}
      </div>
      <button
        className="tab-bar__btn"
        title="Collapse"
        onClick={() => onToggleCollapsed(true)}
      >
        <Minimize2 size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
