import { useEffect, useMemo, useState } from "react";
import { FileText, ScrollText } from "lucide-react";
import type { Ticket } from "@/types/board.ts";
import { TicketLifecycle } from "@/constants/status.ts";
import { deriveLifecycle } from "@/utils/lifecycle.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { TicketArtifactBar, type ArtifactEntry } from "./TicketArtifactBar.tsx";
import { TicketArtifactView } from "./TicketArtifactView.tsx";
import { TicketHistoryView } from "./TicketHistoryView.tsx";
import { TicketFileView } from "./TicketFileView.tsx";
import { deriveTicketArtifacts, type SelectedArtifact } from "./useTicketArtifacts.ts";

interface HistoryEntryLike {
  skill?: string | null;
  filePath?: string;
}

interface Props {
  ticket: Ticket;
  historyEntries: HistoryEntryLike[];
  sessionTouchedFiles: { path: string }[];
  /** Optional controlled selection. When provided, the panel's selection
   *  becomes externally driven; clicks update via `onSelectArtifact`. */
  selectedArtifact?: SelectedArtifact | null;
  onSelectArtifact?: (a: SelectedArtifact | null) => void;
}

function entryId(a: SelectedArtifact): string {
  if (a.kind === "canonical") return `canonical:${a.artifact}`;
  if (a.kind === "plan") return "plan";
  // The filter is body-local state, not a separate bar entry, so the
  // id ignores phaseFilter — one History entry regardless of scope.
  if (a.kind === "history") return "history";
  return `file:${a.filePath}`;
}

function entryLabel(a: SelectedArtifact): string {
  if (a.kind === "canonical") {
    return (
      {
        product_design: "product-design.md",
        technical_design: "technical-design.md",
      } as const
    )[a.artifact];
  }
  if (a.kind === "plan") return "implementation-plan.md";
  if (a.kind === "history") return "History";
  return a.filePath.split("/").pop() ?? a.filePath;
}

function entryIcon(a: SelectedArtifact): React.ReactNode {
  if (a.kind === "history") return <ScrollText size={14} strokeWidth={1.5} />;
  return <FileText size={14} strokeWidth={1.5} />;
}

export function TicketPreviewPanel(props: Props) {
  const { ticket, historyEntries, sessionTouchedFiles } = props;
  const collapsed = useUiStore((s) => s.ticketArtifactBarCollapsed);
  const setCollapsed = useUiStore((s) => s.setTicketArtifactBarCollapsed);

  const amendSpecsFilePaths = useMemo(() => {
    const s = new Set<string>();
    for (const e of historyEntries) {
      if (e.skill === "ticket-amend-specs" && e.filePath) s.add(e.filePath);
    }
    return s;
  }, [historyEntries]);
  const artifacts = useMemo(
    () => deriveTicketArtifacts(
      ticket,
      null,
      historyEntries.length,
      sessionTouchedFiles,
      amendSpecsFilePaths,
    ),
    [ticket, historyEntries.length, sessionTouchedFiles, amendSpecsFilePaths],
  );

  const entries: ArtifactEntry[] = useMemo(
    () =>
      artifacts.map((a) => ({
        id: entryId(a),
        icon: entryIcon(a),
        label: entryLabel(a),
        live: false,
      })),
    [artifacts],
  );

  // During implementation, the plan is the artifact the user most wants to
  // see first; otherwise fall back to the first derived artifact (PD/TD).
  const lifecycle = useMemo(() => deriveLifecycle(ticket.stages), [ticket.stages]);
  const defaultArtifact = useMemo<SelectedArtifact | null>(() => {
    if (lifecycle === TicketLifecycle.Implementation) {
      const planEntry = artifacts.find((a) => a.kind === "plan");
      if (planEntry) return planEntry;
    }
    return artifacts[0] ?? null;
  }, [artifacts, lifecycle]);

  // Controlled vs uncontrolled selection. If `selectedArtifact` is provided,
  // selection is externally driven; otherwise it's locally tracked.
  const [internalSelected, setInternalSelected] = useState<SelectedArtifact | null>(defaultArtifact);
  useEffect(() => {
    if (internalSelected == null && defaultArtifact != null) setInternalSelected(defaultArtifact);
  }, [defaultArtifact, internalSelected]);

  const isControlled = props.selectedArtifact !== undefined;
  // In controlled mode, fall back to the default when the explicit value is null
  // (TicketDetail starts with null but expects the panel to render something).
  const baseSelected =
    (isControlled ? props.selectedArtifact : internalSelected) ?? defaultArtifact;

  const selected = baseSelected;
  const selectedId = selected ? entryId(selected) : null;
  const onSelectId = (id: string) => {
    const found = artifacts.find((a) => entryId(a) === id);
    if (!found) return;
    if (isControlled) {
      props.onSelectArtifact?.(found);
    } else {
      setInternalSelected(found);
    }
  };

  return (
    <div className="ticket-preview-panel">
      <TicketArtifactBar
        entries={entries}
        selectedId={selectedId}
        onSelect={onSelectId}
        collapsed={collapsed}
        onToggleCollapsed={setCollapsed}
      />
      <div className="ticket-preview-body">
        {selected?.kind === "canonical" && (
          <TicketArtifactView ticketId={ticket.id} kind={selected.artifact} />
        )}
        {selected?.kind === "plan" && (
          <TicketArtifactView ticketId={ticket.id} kind="implementation_plan" />
        )}
        {selected?.kind === "history" && (
          <TicketHistoryView
            ticketId={ticket.id}
            phaseFilter={selected.phaseFilter}
            expandIndex={selected.expandIndex}
          />
        )}
        {selected?.kind === "file" && <TicketFileView filePath={selected.filePath} />}
        {!selected && <div className="ticket-preview-empty">No artifact selected</div>}
      </div>
    </div>
  );
}
