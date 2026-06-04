import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import "./Card.css";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className = "", children, ...rest }, ref) {
    return (
      <div ref={ref} className={`card ${className}`.trim()} {...rest}>
        {children}
      </div>
    );
  },
);
