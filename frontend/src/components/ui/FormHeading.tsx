import type { ReactNode } from "react";

interface FormHeadingProps {
  title: string;
  /** Subtitle below the title (may include line breaks via a fragment). */
  subtitle?: ReactNode;
}

/**
 * The accent display heading used atop the new-project forms: a large Sentient
 * title (np-form-title) with an optional subtitle.
 */
export function FormHeading({ title, subtitle }: FormHeadingProps) {
  return (
    <div className="np-form-header">
      <h1 className="np-form-title">{title}</h1>
      {subtitle && <p className="np-form-subtitle">{subtitle}</p>}
    </div>
  );
}
