import { type ComponentPropsWithRef, useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import "./Select.css";

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps extends Omit<ComponentPropsWithRef<"button">, "onChange"> {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  className,
  disabled,
  ...rest
}: SelectProps) {
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

  const handleOptionClick = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const selectedOption = options.find((opt) => opt.value === value);
  const displayText = selectedOption?.label || placeholder || "Select...";

  return (
    <div className={`select-container${className ? ` ${className}` : ""}`} ref={containerRef}>
      <button
        type="button"
        className={`select-button${disabled ? " select-button--disabled" : ""}`}
        onClick={handleToggle}
        disabled={disabled}
        {...rest}
      >
        <span className="select-button-text">{displayText}</span>
        <ChevronDown size={16} strokeWidth={2} className="select-button-icon" />
      </button>

      {isOpen && (
        <div className="select-menu">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`select-menu-item${option.value === value ? " select-menu-item--selected" : ""}`}
              onClick={() => handleOptionClick(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
