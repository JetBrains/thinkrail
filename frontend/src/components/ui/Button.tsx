import type { ComponentPropsWithRef, ReactNode } from "react";

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  /** default = neutral, cancel = subdued, primary = accent, approve = green, deny = red, muted = subdued. */
  variant?: "default" | "cancel" | "primary" | "approve" | "deny" | "muted";
  /** md = 40px (default), sm = 32px, xs = 24px. */
  size?: "md" | "sm" | "xs";
  /** Icon rendered before the label. */
  leadingIcon?: ReactNode;
  /** Icon rendered after the label (e.g. a trailing arrow). */
  trailingIcon?: ReactNode;
}

/**
 * The standard button component used across the app. Supports multiple variants
 * (default, cancel, primary, approve, deny, muted) and sizes (md, sm, xs).
 */
export function Button({ variant = "default", size = "md", leadingIcon, trailingIcon, children, className, ...rest }: ButtonProps) {
  let variantClass = "";
  if (variant === "cancel") variantClass = " np-form-btn-cancel";
  else if (variant === "primary") variantClass = " np-form-btn-primary";
  else if (variant === "approve") variantClass = " np-form-btn-approve";
  else if (variant === "deny") variantClass = " np-form-btn-deny";
  else if (variant === "muted") variantClass = " np-form-btn-muted";

  const sizeClass = size === "sm" ? " np-form-btn-sm" : size === "xs" ? " np-form-btn-xs" : "";

  return (
    <button className={`np-form-btn${variantClass}${sizeClass}${className ? ` ${className}` : ""}`} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
