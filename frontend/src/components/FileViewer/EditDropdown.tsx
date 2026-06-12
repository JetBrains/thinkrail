import { useEffect, useRef } from "react";
import { Pencil, Package, Code, Terminal } from "lucide-react";

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
        <Pencil size={14} style={{ marginRight: "8px" }} />
        Edit in place
      </button>
      <button className="fv-dropdown-item" onClick={onOpenIdea}>
        <Package size={14} style={{ marginRight: "8px" }} />
        Open in IntelliJ IDEA
      </button>
      <button className="fv-dropdown-item" onClick={onOpenVscode}>
        <Code size={14} style={{ marginRight: "8px" }} />
        Open in VS Code
      </button>
      <button className="fv-dropdown-item" onClick={onOpenVim}>
        <Terminal size={14} style={{ marginRight: "8px" }} />
        Open in Vim
      </button>
    </div>
  );
}
