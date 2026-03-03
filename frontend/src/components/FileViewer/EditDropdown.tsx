import { useEffect, useRef } from "react";

interface EditDropdownProps {
  onEditInPlace: () => void;
  onOpenIdea: () => void;
  onOpenVscode: () => void;
  onOpenVim: () => void;
  onClose: () => void;
}

export function EditDropdown({
  onEditInPlace,
  onOpenIdea,
  onOpenVscode,
  onOpenVim,
  onClose,
}: EditDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div className="fv-dropdown" ref={ref}>
      <button className="fv-dropdown-item" onClick={onEditInPlace}>
        {"\u270F\uFE0F"} Edit in place
      </button>
      <button className="fv-dropdown-item" onClick={onOpenIdea}>
        {"\u{1F4E6}"} Open in IntelliJ IDEA
      </button>
      <button className="fv-dropdown-item" onClick={onOpenVscode}>
        {"\u{1F535}"} Open in VS Code
      </button>
      <button className="fv-dropdown-item" onClick={onOpenVim}>
        {"\u{1F4BB}"} Open in Vim
      </button>
    </div>
  );
}
