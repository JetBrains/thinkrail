import type { Ticket, ArtifactKind } from "@/types/board.ts";

/** A selection in the right-column artifact bar. */
export type SelectedArtifact =
  | { kind: "canonical"; artifact: Exclude<ArtifactKind, "implementation_plan" | "history"> }
  | { kind: "plan" }
  /** Parsed history view. Optional `phaseFilter` (a skill id) pre-selects
   *  the in-header filter dropdown (e.g. ticket-amend-specs → "Amendments").
   *  Optional `expandIndex` auto-expands and scrolls to that entry. */
  | { kind: "history"; phaseFilter?: string; expandIndex?: number }
  | { kind: "file"; filePath: string };

/** Pure derivation of the artifact list shown in the right column.
 *
 *  Order: phase canonicals (PD, TD), plan, full history, session-touched
 *  files (deduped). Files touched during the amend-specs phase are excluded
 *  from per-file entries — the History view is their single source of truth. */
export function deriveTicketArtifacts(
  ticket: Ticket,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plan: any,
  historyCount: number,
  sessionTouchedFiles: { path: string }[],
  /** Project-relative paths of files touched by amend-specs. These get
   *  filtered out of the per-file bar entries; the History view (filtered
   *  to amend-specs) is their single source of truth in the right panel. */
  amendSpecsFilePaths: ReadonlySet<string> = new Set(),
): SelectedArtifact[] {
  const out: SelectedArtifact[] = [];
  if (ticket.productDesignPath)
    out.push({ kind: "canonical", artifact: "product_design" });
  if (ticket.technicalDesignPath)
    out.push({ kind: "canonical", artifact: "technical_design" });
  if (ticket.implementationPlanPath || plan) out.push({ kind: "plan" });
  if (historyCount > 0) out.push({ kind: "history" });

  const canonicalPaths = new Set<string>(
    [
      ticket.productDesignPath,
      ticket.technicalDesignPath,
      ticket.historyPath,
      ticket.implementationPlanPath,
    ].filter((p): p is string => !!p),
  );
  const sameFile = (a: string, b: string) =>
    a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
  const seenFiles = new Set<string>();
  for (const f of sessionTouchedFiles) {
    let dedupe = false;
    for (const c of canonicalPaths) {
      if (sameFile(f.path, c)) {
        dedupe = true;
        break;
      }
    }
    if (dedupe) continue;
    // Filter out files represented by the Amendments view (amend-specs
    // history). suffix-match so absolute/relative path variants both hit.
    for (const a of amendSpecsFilePaths) {
      if (sameFile(f.path, a)) {
        dedupe = true;
        break;
      }
    }
    if (dedupe) continue;
    for (const s of seenFiles) {
      if (sameFile(f.path, s)) {
        dedupe = true;
        break;
      }
    }
    if (dedupe) continue;
    seenFiles.add(f.path);
    out.push({ kind: "file", filePath: f.path });
  }
  return out;
}
