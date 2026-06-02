import type { Ticket, ArtifactKind, TicketStatus } from "@/types/board.ts";

/** A selection in the right-column artifact bar. */
export type SelectedArtifact =
  | { kind: "canonical"; artifact: Exclude<ArtifactKind, "implementation_plan" | "history"> }
  | { kind: "plan" }
  /** Parsed history view. Optional `phaseFilter` pre-selects the in-header
   *  filter dropdown (e.g. amend-specs → "Amendments" body title). */
  | { kind: "history"; phaseFilter?: TicketStatus }
  | { kind: "file"; filePath: string };

/** Pure derivation of the artifact list shown in the right column.
 *
 *  Order: phase canonicals (PD, TD), plan, phase-scoped amendments (when
 *  applicable), full history, session-touched files (deduped).
 *
 *  The raw `history.patch` file is NOT surfaced as a canonical artifact —
 *  the file is a log, not a deliverable. The user instead navigates via
 *  the phase-scoped `phase_diff` entry or the full `history` view.
 *
 *  Files touched during the amend-specs phase are also excluded from the
 *  per-file `file` entries: their changes are represented by the
 *  Amendments view, so listing them as standalone pinned artifacts would
 *  be redundant noise that sticks around forever once the phase moves on. */
export function deriveTicketArtifacts(
  ticket: Ticket,
  _plan: unknown,
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
  if (ticket.implementationPlanPath) out.push({ kind: "plan" });
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
