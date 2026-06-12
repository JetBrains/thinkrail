import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  children: ReactNode;
  /** Optional validation message shown below the field. */
  error?: string;
}

/**
 * A labeled form field: a label above the control (passed as children), with an
 * optional error message below. Uses the np-form-* classes from the project
 * form styles.
 */
export function FormField({ label, children, error }: FormFieldProps) {
  return (
    <div className="np-form-field">
      <div className="np-form-label">{label}</div>
      {children}
      {error && <div className="np-form-name-error">{error}</div>}
    </div>
  );
}
