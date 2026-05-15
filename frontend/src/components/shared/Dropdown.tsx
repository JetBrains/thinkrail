import { useEffect, useRef, useState, type ReactNode } from "react";
import "./Dropdown.css";

export interface DropdownOption<T> {
  value: T;
  label: ReactNode;
  /** Optional group label. Consecutive options with the same group render
   *  under one header; sections without a group are rendered ungrouped. */
  group?: string;
}

interface DropdownProps<T> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Class applied to the trigger button so callers can layer colors and
   *  variant styling without touching the dropdown internals. */
  className?: string;
  /** Overrides the rendered trigger text. Defaults to the active option's
   *  label, or stringified value if no option matches. */
  triggerLabel?: ReactNode;
  /** Aligns the menu against the trigger's right edge — useful when the
   *  trigger sits near the right viewport edge and would otherwise overflow. */
  align?: "left" | "right";
  title?: string;
  ariaLabel?: string;
}

const ChevronDown = () => (
  <svg
    className="dd-chevron"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export function Dropdown<T extends string | number | null>({
  value,
  options,
  onChange,
  disabled,
  className = "",
  triggerLabel,
  align = "left",
  title,
  ariaLabel,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const active = options.find((o) => o.value === value);

  // Group consecutive options sharing the same group key. Order from the
  // input is preserved so callers control layout (e.g. "Current" before
  // "Legacy" in the model picker).
  const groups: { name?: string; items: DropdownOption<T>[] }[] = [];
  for (const opt of options) {
    const last = groups[groups.length - 1];
    if (last && last.name === opt.group) {
      last.items.push(opt);
    } else {
      groups.push({ name: opt.group, items: [opt] });
    }
  }

  return (
    <div className="dd" ref={ref}>
      <button
        type="button"
        className={`dd-trigger ${className}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dd-trigger-label">
          {triggerLabel ?? active?.label ?? String(value)}
        </span>
        <ChevronDown />
      </button>
      {open && (
        <div
          className={`dd-menu${align === "right" ? " dd-menu--right" : ""}`}
          role="listbox"
        >
          {groups.map((g, gi) => (
            <div key={g.name ?? `__g${gi}`}>
              {g.name && <div className="dd-group">{g.name}</div>}
              {g.items.map((o) => (
                <button
                  key={String(o.value)}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`dd-item${o.value === value ? " dd-item-active" : ""}`}
                  onClick={() => {
                    if (o.value !== value) onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
