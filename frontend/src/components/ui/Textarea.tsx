import type { ComponentPropsWithRef } from "react";

/** Textarea styled with the project form's np-form-textarea class. */
export function Textarea({ className, ...rest }: ComponentPropsWithRef<"textarea">) {
  return <textarea className={`np-form-textarea${className ? ` ${className}` : ""}`} {...rest} />;
}
