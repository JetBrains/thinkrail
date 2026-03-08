/** Format millisecond duration as "Xs" or "Xm Ys" */
export function formatDuration(ms: number, fractional = true): string {
  if (ms < 60000) {
    return fractional
      ? `${(ms / 1000).toFixed(1)}s`
      : `${Math.round(ms / 1000)}s`;
  }
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Format an ISO date string as a relative "X ago" string */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
