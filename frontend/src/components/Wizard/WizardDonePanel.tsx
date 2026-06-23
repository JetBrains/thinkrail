import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionState } from "@/constants/status.ts";
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
import { ArtifactTabs } from "./ArtifactTabs";
import { ArtifactDocView } from "./ArtifactDocView";
import { useArtifactContents } from "./useArtifactContents";
import { resolveFollowupChain, outcomeTransitions, type StepTransition } from "./registry";
import { useStartWizardStep } from "./useStartWizardStep";
import "./WizardDonePanel.css";

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

  const handleStart = useCallback(
    async (t: StepTransition) => {
      if (busyActionId) return;
      setBusyActionId(t.id);
      try {
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
    [busyActionId, startWizardStep, currentChain, projectName, docContents],
  );

  const handleNavigate = useCallback(
    (action: NavigateAction) => {
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
    [setCenterView, dismissWizardOutcome, session.thinkrailSid, openFile, firstArtifact, projectPath],
  );

  const handleAddTicket = useCallback(
    async (action: CreateTicketAction) => {
      if (busyActionId || action.state === ActionState.Applied) return;
      setBusyActionId(action.id);
      try {
        await createTicket(action.title, action.body ?? undefined, undefined);
        await patchOutcomeAction(session.thinkrailSid, action.id, { state: ActionState.Applied });
      } finally {
        setBusyActionId(null);
      }
    },
    [busyActionId, createTicket, patchOutcomeAction, session.thinkrailSid],
  );

  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const toggleTicketBody = useCallback((id: string) => {
    setExpandedTickets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pendingTickets = tickets.filter((t) => t.state !== ActionState.Applied);
  const handleAddAll = useCallback(async () => {
    if (busyActionId || pendingTickets.length === 0) return;
    setBusyActionId("__add_all__");
    // Don't bail out of the loop on the first failure — try every ticket
    // and report the aggregate. This keeps a transient network blip from
    // turning a 10-ticket batch into a 1-ticket batch.
    let succeeded = 0;
    const failedTitles: string[] = [];
    try {
      for (const t of pendingTickets) {
        try {
          await createTicket(t.title, t.body ?? undefined, undefined);
          await patchOutcomeAction(session.thinkrailSid, t.id, { state: ActionState.Applied });
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
            `Added ${succeeded}/${pendingTickets.length}. ` +
            `Failed: ${failedTitles.slice(0, 3).join(", ")}` +
            (failedTitles.length > 3 ? ` and ${failedTitles.length - 3} more` : ""),
          persistent: false,
        });
      }
    } finally {
      setBusyActionId(null);
    }
  }, [busyActionId, pendingTickets, createTicket, patchOutcomeAction, session.thinkrailSid]);

  return (
    <div className="wiz-done">
      {outcome.summary && (
        <div className="wiz-done-banner">
          <span className="wiz-done-banner-icon" aria-hidden="true">🌱</span>
          <span className="wiz-done-banner-text">{outcome.summary}</span>
        </div>
      )}

      {(heroTransition || navigate.length > 0 || secondaryTransitions.length > 0) && (
        <div className="wiz-done-next-step-row">
          {heroTransition && (
            <button
              type="button"
              className="wiz-done-cta wiz-done-cta--primary"
              onClick={() => handleStart(heroTransition)}
              disabled={busyActionId !== null}
            >
              <span className="wiz-done-cta-body">
                <span className="wiz-done-cta-title">{heroTransition.label}</span>
                {heroTransition.description && (
                  <span className="wiz-done-cta-desc">{heroTransition.description}</span>
                )}
              </span>
              <span className="wiz-done-cta-arrow" aria-hidden="true">→</span>
            </button>
          )}
          {secondaryTransitions.map((t) => (
            <button
              key={t.id}
              type="button"
              className="wiz-done-cta wiz-done-cta--alt"
              onClick={() => handleStart(t)}
              disabled={busyActionId !== null}
            >
              <span className="wiz-done-cta-body">
                <span className="wiz-done-cta-title">{t.label}</span>
                {t.description && <span className="wiz-done-cta-desc">{t.description}</span>}
              </span>
              <span className="wiz-done-cta-arrow" aria-hidden="true">→</span>
            </button>
          ))}
          {navigate.map((a) => (
            <button
              key={a.id}
              type="button"
              className="wiz-done-cta wiz-done-cta--alt"
              onClick={() => handleNavigate(a)}
              disabled={busyActionId !== null}
            >
              <span className="wiz-done-cta-body">
                <span className="wiz-done-cta-title">{a.title}</span>
                {a.description && <span className="wiz-done-cta-desc">{a.description}</span>}
              </span>
              <span className="wiz-done-cta-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      )}

      <div className={`wiz-done-main${openableArtifacts.length > 0 && tickets.length > 0 ? " wiz-done-main--split" : ""}`}>
        {openableArtifacts.length > 0 && (
          <div className="wiz-done-docs">
            {openableArtifacts.length > 1 && (
              <ArtifactTabs
                artifacts={openableArtifacts}
                activePath={activeArtifact.path}
                onSelect={setActiveArtifactPath}
              />
            )}
            <ArtifactDocView
              path={activeArtifact.path}
              label={activeArtifact.label}
              body={docContents[activeArtifact.path]}
              // Inline header is redundant when the tab strip already names
              // the file; show it only in single-artifact mode.
              showHeader={openableArtifacts.length === 1}
            />
          </div>
        )}

        {tickets.length > 0 && (
          <div className="wiz-done-tickets">
            <div className="wiz-done-tickets-head">
              <span className="wiz-done-tickets-title">Suggested tickets</span>
              <span className="wiz-done-tickets-counter">
                <b>{tickets.filter((t) => t.state === ActionState.Applied).length}</b> of {tickets.length} added
              </span>
              {pendingTickets.length > 0 && (
                <button
                  type="button"
                  className="wiz-done-add-all-btn"
                  onClick={handleAddAll}
                  disabled={busyActionId !== null}
                >
                  + Add all {pendingTickets.length}
                </button>
              )}
            </div>
            <ul className="wiz-done-tickets-list">
              {tickets.map((t) => {
                const hasBody = !!t.body;
                const expanded = expandedTickets.has(t.id);
                return (
                  <li key={t.id} className="wiz-done-tickets-li">
                    <div className="wiz-done-tickets-row">
                      <button
                        type="button"
                        className={`wiz-done-tickets-toggle${expanded ? " wiz-done-tickets-toggle--open" : ""}${hasBody ? "" : " wiz-done-tickets-toggle--empty"}`}
                        onClick={() => hasBody && toggleTicketBody(t.id)}
                        disabled={!hasBody}
                        aria-expanded={expanded}
                        aria-label={hasBody ? (expanded ? "Collapse description" : "Expand description") : undefined}
                      >
                        {hasBody ? "▸" : "•"}
                      </button>
                      <span className="wiz-done-tickets-text">{t.title}</span>
                      <button
                        type="button"
                        className={`wiz-done-add-btn${t.state === ActionState.Applied ? " wiz-done-add-btn--added" : ""}`}
                        onClick={() => handleAddTicket(t)}
                        disabled={busyActionId !== null || t.state === ActionState.Applied}
                      >
                        {t.state === ActionState.Applied ? "✓ Added" : "+ Add"}
                      </button>
                    </div>
                    {expanded && hasBody && (
                      <div className="wiz-done-tickets-body-expanded">{t.body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
