/** Extract a human-readable message from an unknown caught value. */
export function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
