import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TicketActionState } from "@/constants/status.ts";
import type {
  CreateTicketAction,
  NavigateAction,
  OutcomeAction,
  Session,
  SessionOutcome,
} from "@/types/session";
import { useUiStore } from "@/store/uiStore";
import { useSessionStore } from "@/store/sessionStore";
import { useBoardStore } from "@/store/boardStore";
import { useFileStore } from "@/store/fileStore";
import { useNotificationStore } from "@/store/notificationStore";
import { ResizeHandle } from "@/components/AppShell/ResizeHandle.tsx";
import { ArtifactTabs } from "./ArtifactTabs";
import { ArtifactDocView } from "./ArtifactDocView";
import { LucideIcon } from "./LucideIcon";
import { useArtifactContents } from "./useArtifactContents";
import { resolveFollowupChain, outcomeTransitions, type StepTransition } from "./registry";
import { useStartWizardStep } from "./useStartWizardStep";
import { getClient } from "@/api/index.ts";
import { createAppSettingsApi, type OnboardingAction } from "@/api/methods/appSettings.ts";
import "./WizardDonePanel.css";

// Copy varies by onboarding flow. We key off the primary artifact the
// step produced — DESIGN_DOC.md for the existing-project investigation,
// GOAL&REQUIREMENTS.md for the greenfield goals flow — so the right
// wording shows regardless of which chain/step lands on this screen.
interface OutcomeCopy {
  title: string;
  /** Lead-in before the saved-file pill. */
  savedPrefix: string;
  ticketsTitle: string;
  /** Plural noun for the counter ("tickets" / "tasks"). */
  ticketsNoun: string;
  ticketsDesc: string;
  nextStepDesc: string;
}

function outcomeCopy(artifactPath: string | null): OutcomeCopy {
  const base = (artifactPath ?? "").split("/").pop()?.toUpperCase() ?? "";
  if (base.startsWith("DESIGN_DOC")) {
    return {
      title: "Design doc is ready",
      savedPrefix: "Saved to",
      ticketsTitle: "Suggested tasks",
      ticketsNoun: "tasks",
      ticketsDesc:
        "Based on what I learned about your project, these tasks capture the gaps and the next moves — the ones you select are added to your board.",
      nextStepDesc:
        "Keep going with me to lock in goals, or jump into the board and start working through the tasks.",
    };
  }
  return {
    title: "Goals and requirements are ready!",
    savedPrefix: "The doc is ready and saved to",
    ticketsTitle: "Suggested tickets",
    ticketsNoun: "tickets",
    ticketsDesc:
      "From the goals & requirements, tickets were drafted to start working on your project. Select the ones to add to the board.",
    nextStepDesc:
      "Pick how you'd like to continue — the tickets selected above are added to the board when you go on.",
  };
}

// Navigate CTAs come from the backend outcome (not the registry). Icon
// and copy are owned here (keyed by destination) so the buttons read
// consistently regardless of what the agent emitted.
const NAV_ICONS: Record<NavigateAction["target"], string> = {
  board: "layout-grid",
  specs: "file-text",
  graph: "git-fork",
  files: "folder",
};
const NAV_COPY: Partial<
  Record<NavigateAction["target"], { title: string; description: string }>
> = {
  board: {
    title: "Open the board",
    description: "The tickets you selected will appear on the board — create new ones anytime.",
  },
};

// Fire-and-forget: a failed analytics ping must never disrupt the wizard.
function trackOnboarding(skillId: string | null, action: OnboardingAction): void {
  if (!skillId) return;
  void createAppSettingsApi(getClient())
    .trackOnboardingAction(skillId, action)
    .catch(() => {});
}

const DEFAULT_DOC_WIDTH = 420;
const MIN_DOC_WIDTH = 320;
// Keep at least this much room for the left (tickets / next-step) column.
const MIN_LEFT_WIDTH = 380;

// One uniform shape for the next-step buttons so the three sources
// (registry hero, registry secondaries, backend navigate actions) render
// through a single template.
interface DoneCta {
  key: string;
  icon?: string | null;
  label: string;
  description?: string | null;
  primary?: boolean;
  onClick: () => void;
}

interface WizardDonePanelProps {
  session: Session;
  outcome: SessionOutcome;
}

// Start-session CTAs come from the wizard registry (the flow's single
// source) — NOT from the backend outcome. Only the content-derived
// actions (suggested tickets, navigation) come from the agent's outcome.
function partitionActions(actions: OutcomeAction[]): {
  navigate: NavigateAction[];
  tickets: CreateTicketAction[];
} {
  const navigate: NavigateAction[] = [];
  const tickets: CreateTicketAction[] = [];
  for (const a of actions) {
    if (a.type === "navigate") navigate.push(a);
    else if (a.type === "create_ticket") tickets.push(a);
  }
  return { navigate, tickets };
}

export function WizardDonePanel({ session, outcome }: WizardDonePanelProps) {
  const projectPath = useUiStore((s) => s.projectPath);
  const projectName = useUiStore((s) => s.projectName);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const currentChain = useUiStore((s) => s.currentChain);
  const startWizardStep = useStartWizardStep();
  const dismissWizardOutcome = useUiStore((s) => s.dismissWizardOutcome);
  const patchOutcomeAction = useSessionStore((s) => s.patchOutcomeAction);
  const createTicket = useBoardStore((s) => s.createTicket);
  const openFile = useFileStore((s) => s.openFile);

  const { navigate, tickets } = useMemo(
    () => partitionActions(outcome.actions),
    [outcome.actions],
  );

  // Start-session CTAs are owned by the registry (the flow lives in one
  // place), resolved for the step this session belongs to in the active
  // chain. The headline CTA is the one marked primary, else the first.
  const transitions = useMemo(
    () => outcomeTransitions(session.skillId, currentChain ?? undefined),
    [session.skillId, currentChain],
  );
  const heroTransition = useMemo<StepTransition | null>(
    () => transitions.find((t) => t.primary) ?? transitions[0] ?? null,
    [transitions],
  );
  const secondaryTransitions = useMemo(
    () => transitions.filter((t) => t !== heroTransition),
    [transitions, heroTransition],
  );

  const openableArtifacts = useMemo(
    () => outcome.artifacts.filter((a) => a.openOnDone ?? true),
    [outcome.artifacts],
  );
  // Kept for legacy callers (navigate-to-files target uses it).
  const firstArtifact = openableArtifacts[0] ?? null;

  // When multiple artifacts are openable, the doc panel shows one at a
  // time with a tab strip — instead of splitting the panel vertically.
  // Default-select the first artifact; switching tabs is purely visual,
  // contents are already loaded in parallel.
  const [activeArtifactPath, setActiveArtifactPath] = useState<string | null>(
    firstArtifact?.path ?? null,
  );
  useEffect(() => {
    // Sync selection if the artifact list changes (e.g. outcome refresh).
    if (
      activeArtifactPath == null ||
      !openableArtifacts.some((a) => a.path === activeArtifactPath)
    ) {
      setActiveArtifactPath(firstArtifact?.path ?? null);
    }
  }, [openableArtifacts, firstArtifact, activeArtifactPath]);
  const activeArtifact =
    openableArtifacts.find((a) => a.path === activeArtifactPath) ??
    firstArtifact;

  const docContents = useArtifactContents(projectPath, openableArtifacts);

  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  // Doc panel width: defaults to half the available width, but tracks the
  // container so the default stays "half" on resize until the user drags it.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [docWidth, setDocWidth] = useState<number | null>(null);
  const hasArtifacts = openableArtifacts.length > 0;
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !hasArtifacts) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasArtifacts]);
  const docMaxWidth = containerW
    ? Math.max(MIN_DOC_WIDTH, containerW - MIN_LEFT_WIDTH)
    : DEFAULT_DOC_WIDTH;
  const resolvedDocWidth =
    docWidth ??
    (containerW
      ? Math.min(docMaxWidth, Math.max(MIN_DOC_WIDTH, Math.round(containerW * 0.5)))
      : DEFAULT_DOC_WIDTH);

  // Ticket checkboxes only SELECT — the chosen tickets are created on the
  // board when the user commits via a next-step CTA. Default: every
  // not-yet-applied ticket is selected. Tickets already applied (rare on
  // first view) stay checked and locked.
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedTickets(
      new Set(tickets.filter((t) => t.state !== TicketActionState.Applied).map((t) => t.id)),
    );
  }, [tickets]);
  const isChecked = useCallback(
    (t: CreateTicketAction) => t.state === TicketActionState.Applied || selectedTickets.has(t.id),
    [selectedTickets],
  );
  const toggleSelected = useCallback((id: string) => {
    setSelectedTickets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectedCount = tickets.filter(isChecked).length;

  // Creates the checked-and-not-yet-applied tickets on the board, marking
  // each applied. Errors are aggregated into one toast — a transient blip
  // on one ticket must not abort the rest (or block the transition).
  const applySelectedTickets = useCallback(async () => {
    const toAdd = tickets.filter(
      (t) => t.state !== TicketActionState.Applied && selectedTickets.has(t.id),
    );
    if (toAdd.length === 0) return;
    trackOnboarding(session.skillId, "add_suggested_tickets");
    let succeeded = 0;
    const failedTitles: string[] = [];
    for (const t of toAdd) {
      try {
        await createTicket(t.title, t.body ?? undefined, undefined);
        await patchOutcomeAction(session.thinkrailSid, t.id, { state: TicketActionState.Applied });
        succeeded++;
      } catch (e) {
        console.error("[WizardDonePanel] failed to add ticket", t.id, e);
        failedTitles.push(t.title);
      }
    }
    if (failedTitles.length > 0) {
      useNotificationStore.getState().addToast({
        eventType: "error",
        message:
          `Added ${succeeded}/${toAdd.length}. ` +
          `Failed: ${failedTitles.slice(0, 3).join(", ")}` +
          (failedTitles.length > 3 ? ` and ${failedTitles.length - 3} more` : ""),
        persistent: false,
      });
    }
  }, [tickets, selectedTickets, createTicket, patchOutcomeAction, session.thinkrailSid, session.skillId]);

  const handleStart = useCallback(
    async (t: StepTransition) => {
      if (busyActionId) return;
      setBusyActionId(t.id);
      trackOnboarding(session.skillId, "continue");
      try {
        await applySelectedTickets();
        // The transition builds the next session's ``session_prompt``
        // from runtime context (e.g. the draft G&R body produced by the
        // previous step). It belongs in ``session_prompt`` → the agent's
        // "## Your Task" system-prompt section, not the chat transcript.
        const sessionPrompt =
          t.buildPrompt?.({ projectName, artifacts: docContents })?.trim() || undefined;
        // `startWizardStep` pins the resolved follow-up chain, seeds the
        // journey, and kicks the session — so the cumulative stepper keeps
        // growing instead of resetting when the chain changes.
        await startWizardStep({
          skillId: t.target,
          chainId: resolveFollowupChain(currentChain, t.target),
          name: t.label,
          prompt: sessionPrompt,
          kick: "Begin.",
        });
      } finally {
        setBusyActionId(null);
      }
    },
    [busyActionId, applySelectedTickets, startWizardStep, currentChain, projectName, docContents, session.skillId],
  );

  const handleNavigate = useCallback(
    async (action: NavigateAction) => {
      if (busyActionId) return;
      setBusyActionId(action.id);
      trackOnboarding(session.skillId, "open_workspace");
      try {
        await applySelectedTickets();
      } finally {
        setBusyActionId(null);
      }
      // The user is opting out of the wizard for this session — they've
      // seen the done-screen and chose a different destination. Mark the
      // outcome as dismissed so re-activating this session (clicking it
      // in the tab bar, or after a page reload) drops them into the
      // regular session UX instead of the done-screen.
      dismissWizardOutcome(session.thinkrailSid);
      if (action.target === "board") {
        useBoardStore.setState({ activeTicketId: null });
        setCenterView("board");
      } else if (action.target === "files" && firstArtifact && projectPath) {
        // Open the artifact file when navigating to "files" makes sense.
        void openFile(firstArtifact.path);
        setCenterView("sessions");
      } else {
        // "specs" / "graph" — caller is expected to handle via global nav.
        // For now route everything else to sessions view.
        setCenterView("sessions");
      }
    },
    [busyActionId, applySelectedTickets, setCenterView, dismissWizardOutcome, session.thinkrailSid, session.skillId, openFile, firstArtifact, projectPath],
  );

  const copy = useMemo(() => outcomeCopy(firstArtifact?.path ?? null), [firstArtifact]);

  // Start-session CTAs (registry) + navigate CTAs (backend, with frontend
  // copy/icon) collapsed into one ordered list rendered by a single template.
  const ctas: DoneCta[] = [
    ...(heroTransition
      ? [{
          key: heroTransition.id,
          icon: heroTransition.icon,
          label: heroTransition.label,
          description: heroTransition.description,
          primary: true,
          onClick: () => handleStart(heroTransition),
        }]
      : []),
    ...secondaryTransitions.map((t) => ({
      key: t.id,
      icon: t.icon,
      label: t.label,
      description: t.description,
      onClick: () => handleStart(t),
    })),
    ...navigate.map((a) => {
      const navCopy = NAV_COPY[a.target];
      return {
        key: a.id,
        icon: NAV_ICONS[a.target],
        label: navCopy?.title ?? a.title,
        description: navCopy?.description ?? a.description,
        onClick: () => handleNavigate(a),
      };
    }),
  ];

  return (
    <div className="wiz-done">
      <div className="wiz-done-container" ref={containerRef}>
        <div className="wiz-done-left">
        <header className="wiz-done-header">
          <h1 className="wiz-done-title">{copy.title}</h1>
          {openableArtifacts.length > 0 && (
            <p className="wiz-done-subtitle">
              {copy.savedPrefix}{" "}
              {openableArtifacts.map((a, i) => {
                const name = a.path.replace(/^\.tr\//, "");
                const sep =
                  i === 0
                    ? ""
                    : i === openableArtifacts.length - 1
                      ? " and "
                      : ", ";
                return (
                  <Fragment key={a.path}>
                    {sep}
                    <code className="wiz-done-subtitle-pill">{name}</code>
                    {a.label ? ` (${a.label})` : ""}
                  </Fragment>
                );
              })}
            </p>
          )}
        </header>

        {tickets.length > 0 && (
          <section className="wiz-done-section wiz-done-section--scroll">
            <div className="wiz-done-section-head">
              <h2 className="wiz-done-section-title">{copy.ticketsTitle}</h2>
              <span className="wiz-done-tickets-counter">
                <b>{selectedCount}</b>/{tickets.length} {copy.ticketsNoun} selected
              </span>
            </div>
            <p className="wiz-done-section-desc">{copy.ticketsDesc}</p>
            <ul className="wiz-done-rows">
              {tickets.map((t) => {
                const applied = t.state === TicketActionState.Applied;
                const checked = isChecked(t);
                const disabled = applied || busyActionId !== null;
                return (
                  <li key={t.id}>
                    <div
                      className={`wiz-done-row${disabled ? "" : " wiz-done-row--clickable"}`}
                      onClick={() => !disabled && toggleSelected(t.id)}
                      role="checkbox"
                      aria-checked={checked}
                      tabIndex={disabled ? undefined : 0}
                    >
                      <div className={`wiz-done-check${checked ? " wiz-done-check--on" : ""}`}>
                        {checked && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div className="wiz-done-row-info">
                        <div className="wiz-done-row-name">{t.title}</div>
                        {t.body && <div className="wiz-done-row-desc">{t.body}</div>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {ctas.length > 0 && (
          <section className="wiz-done-section">
            <h2 className="wiz-done-section-title">Choose your next step</h2>
            <p className="wiz-done-section-desc">{copy.nextStepDesc}</p>
            <div className="wiz-done-cta-row">
              {ctas.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`wiz-done-cta${c.primary ? " wiz-done-cta--primary" : ""}`}
                  onClick={c.onClick}
                  disabled={busyActionId !== null}
                >
                  <span className="wiz-done-cta-title">
                    <LucideIcon name={c.icon} size={16} />
                    {c.label}
                  </span>
                  {c.description && <span className="wiz-done-cta-desc">{c.description}</span>}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {openableArtifacts.length > 0 && (
        <>
        <ResizeHandle
          side="right"
          panelWidth={resolvedDocWidth}
          onResize={setDocWidth}
          onCollapse={() => {}}
          min={MIN_DOC_WIDTH}
          max={docMaxWidth}
          collapseThreshold={0}
          handleWidth={6}
          restColor="transparent"
          hoverColor="var(--primary)"
        />
        <div className="wiz-done-right" style={{ flex: `0 0 ${resolvedDocWidth}px`, width: resolvedDocWidth }}>
          <div className="wiz-done-doc-header">
            {openableArtifacts.length > 1 ? (
              <ArtifactTabs
                artifacts={openableArtifacts}
                activePath={activeArtifact.path}
                onSelect={setActiveArtifactPath}
              />
            ) : (
              <span className="wiz-done-doc-header-title">
                {activeArtifact.path.replace(/^\.tr\//, "")}
              </span>
            )}
          </div>
          <ArtifactDocView
            path={activeArtifact.path}
            label={activeArtifact.label}
            body={docContents[activeArtifact.path]}
            // The filename now lives in the panel header (tab strip or
            // title), so the doc body never renders its own inline header.
            showHeader={false}
          />
        </div>
        </>
      )}
      </div>
    </div>
  );
}
