import type { RuntimeFlag } from "@/types/rpc-methods.ts";

interface RuntimeFlagsProps {
  /** Runtime-declared flags from `runtimes/capabilities`. */
  flags: RuntimeFlag[];
  /** Current values, keyed by flag key; missing keys fall back to the flag default. */
  value: Record<string, boolean>;
  onChange: (key: string, checked: boolean) => void;
  /** Disambiguates element ids when more than one instance is mounted. */
  idPrefix: string;
  disabled?: boolean;
}

/**
 * Renders one control per runtime-declared flag, switched on `flag.type`.
 * Data-driven: a flag added on the backend shows up here with no code change.
 * Unknown types are skipped rather than rendered blank.
 */
export function RuntimeFlags({ flags, value, onChange, idPrefix, disabled }: RuntimeFlagsProps) {
  const booleanFlags = flags.filter((f) => f.type === "boolean");
  if (booleanFlags.length === 0) return null;
  return (
    <>
      {booleanFlags.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        return (
          <label key={f.key} className="runtime-flag" htmlFor={id} title={f.description}>
            <input
              id={id}
              type="checkbox"
              checked={value[f.key] ?? f.default}
              disabled={disabled}
              onChange={(e) => onChange(f.key, e.target.checked)}
            />
            <span>{f.label}</span>
          </label>
        );
      })}
    </>
  );
}
