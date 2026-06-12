import type { ComponentPropsWithRef } from "react";
import "./Input.css";

interface InputProps extends ComponentPropsWithRef<"input"> {
  error?: boolean;
}

export function Input({ error, className, ...rest }: InputProps) {
  const cls = `input${error ? " input--error" : ""}${className ? ` ${className}` : ""}`;
  return <input className={cls} type="text" {...rest} />;
}
