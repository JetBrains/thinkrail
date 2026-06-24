import { useCallback, useEffect, useMemo, useState } from "react";
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
import { LucideIcon } from "./LucideIcon";
import { useArtifactContents } from "./useArtifactContents";
import { resolveFollowupChain, outcomeTransitions, type StepTransition } from "./registry";
import { useStartWizardStep } from "./useStartWizardStep";
import { getClient } from "@/api/index.ts";
import { createAppSettingsApi, type OnboardingAction } from "@/api/methods/appSettings.ts";
import "./WizardDonePanel.css";

const SECTION_COPY = {
  tickets:
    "From the goals & requirements, tickets were drafted to start working on your project. Select the ones to add to the board.",
  nextStep:
    "Pick how you'd like to continue — the tickets selected above are added to the board when you go on.",
} as const;

// Navigate CTAs come from the backend outcome (not the registry), so their
// icon is mapped here by destination rather than carried on the action.
const NAV_ICONS: Record<NavigateAction["target"], string> = {
  board: "layout-grid",
  specs: "file-text",
  graph: "git-fork",
  files: "folder",
};

// Fire-and-forget: a failed analytics ping must never disrupt the wizard.
function trackOnboarding(skillId: string | null, action: OnboardingAction): void {
  if (!skillId) return;
  void createAppSettingsApi(getClient())
    .trackOnboardingAction(skillId, action)
    .catch(() => {});
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

  // Ticket checkboxes only SELECT — the chosen tickets are created on the
  // board when the user commits via a next-step CTA. Default: every
  // not-yet-applied ticket is selected. Tickets already applied (rare on
  // first view) stay checked and locked.
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedTickets(
      new Set(tickets.filter((t) => t.state !== "applied").map((t) => t.id)),
    );
  }, [tickets]);
  const isChecked = useCallback(
    (t: CreateTicketAction) => t.state === "applied" || selectedTickets.has(t.id),
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
      (t) => t.state !== "applied" && selectedTickets.has(t.id),
    );
    if (toAdd.length === 0) return;
    trackOnboarding(session.skillId, "add_suggested_tickets");
    let succeeded = 0;
    const failedTitles: string[] = [];
    for (const t of toAdd) {
      try {
        await createTicket(t.title, t.body ?? undefined, undefined);
        await patchOutcomeAction(session.thinkrailSid, t.id, { state: "applied" });
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

  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const toggleTicketBody = useCallback((id: string) => {
    setExpandedTickets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const subtitlePath = firstArtifact?.path.replace(/^\.tr\//, "") ?? null;
  const hasNextStep =
    heroTransition || navigate.length > 0 || secondaryTransitions.length > 0;

  return (
    <div className={`wiz-done${openableArtifacts.length > 0 ? " wiz-done--cols" : ""}`}>
      <div className="wiz-done-left">
        <header className="wiz-done-header">
          {outcome.summary && <h1 className="wiz-done-title">{outcome.summary}</h1>}
          {subtitlePath && (
            <p className="wiz-done-subtitle">
              The doc is ready and saved to{" "}
              <code className="wiz-done-subtitle-pill">{subtitlePath}</code>
            </p>
          )}
        </header>

        {tickets.length > 0 && (
          <section className="wiz-done-section">
            <div className="wiz-done-section-head">
              <h2 className="wiz-done-section-title">Suggested tickets</h2>
              <span className="wiz-done-tickets-counter">
                <b>{selectedCount}</b>/{tickets.length} tickets selected
              </span>
            </div>
            <p className="wiz-done-section-desc">{SECTION_COPY.tickets}</p>
            <ul className="wiz-done-tickets-list">
              {tickets.map((t) => {
                const hasBody = !!t.body;
                const expanded = expandedTickets.has(t.id);
                const applied = t.state === "applied";
                return (
                  <li key={t.id} className="wiz-done-tickets-li">
                    <div className="wiz-done-tickets-row">
                      <input
                        type="checkbox"
                        className="wiz-done-tickets-check"
                        checked={isChecked(t)}
                        disabled={applied || busyActionId !== null}
                        onChange={() => toggleSelected(t.id)}
                        aria-label={`Select ticket: ${t.title}`}
                      />
                      <span className="wiz-done-tickets-text">{t.title}</span>
                      {hasBody && (
                        <button
                          type="button"
                          className={`wiz-done-tickets-toggle${expanded ? " wiz-done-tickets-toggle--open" : ""}`}
                          onClick={() => toggleTicketBody(t.id)}
                          aria-expanded={expanded}
                          aria-label={expanded ? "Collapse description" : "Expand description"}
                        >
                          ▸
                        </button>
                      )}
                    </div>
                    {expanded && hasBody && (
                      <div className="wiz-done-tickets-body-expanded">{t.body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {hasNextStep && (
          <section className="wiz-done-section">
            <h2 className="wiz-done-section-title">Choose your next step</h2>
            <p className="wiz-done-section-desc">{SECTION_COPY.nextStep}</p>
            <div className="wiz-done-cta-row">
              {heroTransition && (
                <button
                  type="button"
                  className="wiz-done-cta wiz-done-cta--primary"
                  onClick={() => handleStart(heroTransition)}
                  disabled={busyActionId !== null}
                >
                  <span className="wiz-done-cta-icon" aria-hidden="true">
                    <LucideIcon name={heroTransition.icon} size={18} />
                  </span>
                  <span className="wiz-done-cta-body">
                    <span className="wiz-done-cta-title">{heroTransition.label}</span>
                    {heroTransition.description && (
                      <span className="wiz-done-cta-desc">{heroTransition.description}</span>
                    )}
                  </span>
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
                  <span className="wiz-done-cta-icon" aria-hidden="true">
                    <LucideIcon name={t.icon} size={18} />
                  </span>
                  <span className="wiz-done-cta-body">
                    <span className="wiz-done-cta-title">{t.label}</span>
                    {t.description && <span className="wiz-done-cta-desc">{t.description}</span>}
                  </span>
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
                  <span className="wiz-done-cta-icon" aria-hidden="true">
                    <LucideIcon name={NAV_ICONS[a.target]} size={18} />
                  </span>
                  <span className="wiz-done-cta-body">
                    <span className="wiz-done-cta-title">{a.title}</span>
                    {a.description && <span className="wiz-done-cta-desc">{a.description}</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {openableArtifacts.length > 0 && (
        <div className="wiz-done-right">
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
    </div>
  );
}
