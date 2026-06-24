import type { LabeledOption } from "@/types/rpc-methods.ts";

/** Hover tooltip for a permission mode: prose followed by the raw SDK value
 *  (so power users still see the real mode name). Falls back to the value
 *  alone when no prose is provided. */
export function permissionModeTooltip(opt: LabeledOption): string {
  return opt.description ? `${opt.description}  ·  ${opt.value}` : opt.value;
}

/** Display label for a permission-mode value, falling back to the raw value
 *  when the active mode isn't in the runtime's advertised list. */
export function permissionModeLabel(
  modes: LabeledOption[],
  value: string,
): string {
  return modes.find((m) => m.value === value)?.label ?? value;
}
