import type { ReactNode } from "react";

interface TicketSectionProps {
  title: string;
  /** When set, the header is clickable and shows the active highlight. */
  onHeaderClick?: () => void;
  active?: boolean;
  /** Right-aligned badge in the header (e.g. a count like "3 applied" or "2/5"). */
  badge?: ReactNode;
  children?: ReactNode;
}

/**
 * A labeled section in the ticket detail panel: a (optionally clickable) header
 * with a title + optional badge, above its content. Used for Description,
 * Specifications, Spec Diffs, Plan and Sessions in TicketInfo.
 */
export function TicketSection({ title, onHeaderClick, active, badge, children }: TicketSectionProps) {
  const headerClass = `ticket-section-header${onHeaderClick ? " ticket-section-clickable" : ""}${
    onHeaderClick && active ? " ticket-section-clickable--active" : ""
  }`;
  return (
    <div className="ticket-section">
      <div className={headerClass} onClick={onHeaderClick}>
        <span className="ticket-section-title">{title}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}
