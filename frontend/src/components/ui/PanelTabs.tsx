import type { ReactNode } from "react";

export interface PanelTabItem<T extends string> {
  id: T;
  label: string;
}

/** The left-panel tab bar (text-only), e.g. Specs / Files / Progress.
 *  `trailing` renders after the tabs (used for the collapse button). */
export function PanelTabs<T extends string>({
  tabs,
  active,
  onChange,
  trailing,
}: {
  tabs: PanelTabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="panel-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`panel-tab ${active === tab.id ? "panel-tab-active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}
