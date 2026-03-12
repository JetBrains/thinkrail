import "./utils.css";

export function relativeDate(iso: string): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return iso;
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 4) return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  const months = Math.floor(diffDays / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(diffDays / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="status-badge" data-status={status}>
      {status}
    </span>
  );
}

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function dirName(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

export function fileMatchesCovers(filePath: string, covers: string[]): boolean {
  return covers.some((pattern) =>
    filePath.startsWith(pattern) || filePath === pattern
  );
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : p;
}
