import { useCallback, useState } from "react";
import "./CollapsibleSection.css";

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultExpanded?: boolean;
  expandToCenter?: () => void;
  summary?: React.ReactNode;
  children: React.ReactNode;
}

function getStorageKey(title: string): string {
  return `bonsai-section-${title}`;
}

function readExpanded(title: string, defaultExpanded: boolean): boolean {
  try {
    const val = localStorage.getItem(getStorageKey(title));
    if (val !== null) return val === "true";
  } catch { /* ignore */ }
  return defaultExpanded;
}

export function CollapsibleSection({
  title,
  count,
  defaultExpanded = true,
  expandToCenter,
  summary,
  children,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(() => readExpanded(title, defaultExpanded));

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem(getStorageKey(title), String(next)); } catch { /* ignore */ }
      return next;
    });
  }, [title]);

  return (
    <div className={`collapsible-section ${expanded ? "collapsible-section--expanded" : ""}`}>
      <button className="collapsible-section__header" onClick={toggle}>
        <span className="collapsible-section__chevron">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className="collapsible-section__title">{title}</span>
        {count !== undefined && (
          <span className="collapsible-section__count">{count}</span>
        )}
        {!expanded && summary && (
          <span className="collapsible-section__summary">{summary}</span>
        )}
        {expandToCenter && (
          <span
            className="collapsible-section__expand"
            onClick={(e) => { e.stopPropagation(); expandToCenter(); }}
            title="Open in center panel"
          >
            {"\u21F1"}
          </span>
        )}
      </button>
      <div className={`collapsible-section__body ${expanded ? "collapsible-section__body--open" : ""}`}>
        <div className="collapsible-section__content">
          {children}
        </div>
      </div>
    </div>
  );
}
