import type { ReactNode } from "react";

export interface NavTabItem<T extends string> {
  id: T;
  icon: ReactNode;
  label: string;
}

/** The header navigation tabs (icon + label), e.g. Sessions / Tickets / Specs / Files. */
export function NavTabs<T extends string>({
  tabs = [],
  active,
  onSelect,
}: {
  tabs?: NavTabItem<T>[];
  active?: T;
  onSelect?: (id: T) => void;
}) {
  return (
    <div className="header-nav-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`header-nav-tab${active === tab.id ? " header-nav-tab--active" : ""}`}
          onClick={() => onSelect?.(tab.id)}
        >
          <span className="header-nav-tab-icon">{tab.icon}</span>
          <span className="header-nav-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
