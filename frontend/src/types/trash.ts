export interface TrashedItem {
  id: string;
  type: string; // "sessions" | "tickets" | "specs" | "plans" | "drafts" | "patches"
  trashedAt: string;
  originalDir: string;
  context: Record<string, unknown>;
  display?: Record<string, unknown>; // extracted from trashed data files for UI
}
