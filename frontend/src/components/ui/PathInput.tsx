import { Folder } from "lucide-react";

interface PathInputProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When provided, the folder icon becomes a clickable "browse" button. */
  onBrowse?: () => void;
}

/**
 * A path/location field: a text input with a trailing folder icon. If `onBrowse`
 * is given the icon is a clickable browse button; otherwise it's a static icon.
 */
export function PathInput({ value, onChange, placeholder, disabled, onBrowse }: PathInputProps) {
  return (
    <div className="np-form-input-with-icon">
      <input
        className="np-form-input"
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
      {onBrowse ? (
        <button className="np-form-input-icon-btn" onClick={onBrowse} type="button" title="Browse folders">
          <Folder size={16} strokeWidth={1.5} />
        </button>
      ) : (
        <Folder size={16} className="np-form-input-icon" strokeWidth={1.5} />
      )}
    </div>
  );
}
