/** Session name derivation from the in-progress prompt. No React/store deps. */

export const DEFAULT_SESSION_NAME = "New session";

/** Max label length, including the ellipsis character. */
export const NAME_MAX = 15;

/** Non-whitespace chars required before autosave arms. */
export const SAVE_THRESHOLD = 5;

export function nonWs(text: string): number {
  return text.replace(/\s/g, "").length;
}

export function deriveSessionName(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (collapsed.length === 0) return DEFAULT_SESSION_NAME;
  if (collapsed.length <= NAME_MAX) return collapsed;
  return collapsed.slice(0, NAME_MAX - 1) + "…";
}

/** Resolve a restored draft's tab name. A persisted name that is neither the
 *  default nor what derivation would produce is a manual rename — keep it and
 *  freeze derivation. `nameManuallySet` is not persisted, so this is the only
 *  signal that survives a reload. */
export function resolveDraftName(
  persistedName: string | null | undefined,
  draftInput: string,
): { name: string; nameManuallySet: boolean } {
  const derived = deriveSessionName(draftInput);
  if (persistedName && persistedName !== DEFAULT_SESSION_NAME && persistedName !== derived) {
    return { name: persistedName, nameManuallySet: true };
  }
  return { name: derived, nameManuallySet: false };
}
