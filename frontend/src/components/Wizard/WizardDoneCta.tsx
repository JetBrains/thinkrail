import type { ReactNode } from "react";

interface WizardDoneCtaProps {
  title: ReactNode;
  description?: ReactNode;
  /** "primary" is the highlighted hero action; "alt" is a secondary next step. */
  variant?: "primary" | "alt";
  onClick?: () => void;
  disabled?: boolean;
}

/**
 * A single "next step" call-to-action card on the wizard done screen: a
 * title, an optional description, and a trailing arrow. Used for the hero
 * start-session action and the secondary start/navigate actions.
 */
export function WizardDoneCta({ title, description, variant = "alt", onClick, disabled }: WizardDoneCtaProps) {
  return (
    <button
      type="button"
      className={`wiz-done-cta wiz-done-cta--${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="wiz-done-cta-body">
        <span className="wiz-done-cta-title">{title}</span>
        {description && <span className="wiz-done-cta-desc">{description}</span>}
      </span>
      <span className="wiz-done-cta-arrow" aria-hidden="true">→</span>
    </button>
  );
}
