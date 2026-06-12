import type { ComponentPropsWithRef } from "react";

interface TextInputProps extends ComponentPropsWithRef<"input"> {
  /** Applies the error styling (red outline). */
  error?: boolean;
}

/** Text input styled with the project form's np-form-input class. */
export function TextInput({ error, className, ...rest }: TextInputProps) {
  const cls = `np-form-input${error ? " np-form-input--error" : ""}${className ? ` ${className}` : ""}`;
  return <input className={cls} type="text" {...rest} />;
}
