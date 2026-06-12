import { useRef, type ChangeEvent } from "react";
import { Paperclip } from "lucide-react";

export interface AttachedFile {
  name: string;
  content: string;
}

interface FileAttachProps {
  attachedFile: AttachedFile | null;
  onAttach: (file: AttachedFile | null) => void;
  disabled?: boolean;
  hint?: string;
}

const DEFAULT_HINT = "PDF, Markdown, plain text — anything you've already written about the idea.";
const ACCEPT = ".txt,.md,.pdf,.doc,.docx,.rtf,.csv,.json,.yaml,.yml";

/**
 * "Attach document" control: a button that opens a file picker, reads the file
 * as text, and shows the attached file name with a remove button (or a hint).
 * Owns the hidden file input + FileReader; reports via onAttach.
 */
export function FileAttach({ attachedFile, onAttach, disabled, hint }: FileAttachProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => onAttach({ name: file.name, content: evt.target?.result as string });
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="np-form-attach-row">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <button
        className="np-form-attach-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        type="button"
      >
        <Paperclip size={16} strokeWidth={1.5} />
        Attach document
      </button>
      {attachedFile ? (
        <span className="np-form-attached-file">
          {attachedFile.name}
          <button className="np-form-attached-remove" onClick={() => onAttach(null)} title="Remove">
            ×
          </button>
        </span>
      ) : (
        <span className="np-form-hint">{hint ?? DEFAULT_HINT}</span>
      )}
    </div>
  );
}
