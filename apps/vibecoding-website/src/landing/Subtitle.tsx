import type { CSSProperties, ReactNode } from "react";

export function Subtitle({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <p
      className={`max-w-[600px] text-[1.08rem] leading-relaxed font-[350] text-text-muted whitespace-pre-line ${className}`}
      style={style}
    >
      {children}
    </p>
  );
}
