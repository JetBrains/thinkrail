import type { ReactNode } from "react";

interface ActionCardProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
  /** Highlighted (green) variant. */
  primary?: boolean;
}

/**
 * A large choice card: icon + title + subtitle, used on the project picker
 * ("Start a new project" / "Open an existing project"). Pass a styled icon
 * (e.g. with the picker-cta-icon class).
 */
export function ActionCard({ icon, title, subtitle, onClick, disabled, primary }: ActionCardProps) {
  return (
    <button className={`picker-cta${primary ? " picker-cta-primary" : ""}`} onClick={onClick} disabled={disabled}>
      {icon}
      <span className="picker-cta-h">{title}</span>
      <span className="picker-cta-s">{subtitle}</span>
    </button>
  );
}
