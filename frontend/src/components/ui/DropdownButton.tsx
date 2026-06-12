import { type ComponentPropsWithRef, type ReactNode, useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import "./DropdownButton.css";

export interface DropdownOption {
  label: string;
  value: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface DropdownButtonProps extends Omit<ComponentPropsWithRef<"button">, "onClick"> {
  /** Button label */
  children: ReactNode;
  /** Dropdown options */
  options: DropdownOption[];
  /** Callback when an option is selected */
  onSelect: (value: string) => void;
  /** Button variant: default = neutral, cancel = subdued, primary = accent. */
  variant?: "default" | "cancel" | "primary";
  /** Button size: md = 40px (default), sm = 32px, xs = 24px. */
  size?: "md" | "sm" | "xs";
}

/**
 * A button with a dropdown menu. Extends the Button component with dropdown
 * functionality and shows options on click.
 */
export function DropdownButton({
  children,
  options,
  onSelect,
  variant = "primary",
  size = "md",
  className,
  disabled,
  ...rest
}: DropdownButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleOptionClick = (value: string, optionDisabled?: boolean) => {
    if (!optionDisabled) {
      onSelect(value);
      setIsOpen(false);
    }
  };

  const variantClass = variant === "cancel" ? " np-form-btn-cancel" : variant === "primary" ? " np-form-btn-primary" : "";
  const sizeClass = size === "sm" ? " np-form-btn-sm" : size === "xs" ? " np-form-btn-xs" : "";

  return (
    <div className="dropdown-btn-container" ref={containerRef}>
      <button
        className={`np-form-btn dropdown-btn${variantClass}${sizeClass}${className ? ` ${className}` : ""}`}
        onClick={handleToggle}
        disabled={disabled}
        {...rest}
      >
        {children}
        <ChevronDown size={16} strokeWidth={2} className="dropdown-btn-chevron" />
      </button>

      {isOpen && (
        <div className="dropdown-menu">
          {options.map((option) => (
            <button
              key={option.value}
              className={`dropdown-menu-item${option.disabled ? " dropdown-menu-item--disabled" : ""}`}
              onClick={() => handleOptionClick(option.value, option.disabled)}
              disabled={option.disabled}
            >
              {option.icon && <span className="dropdown-menu-item-icon">{option.icon}</span>}
              <span className="dropdown-menu-item-label">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
