import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CreateTicketAction,
  NavigateAction,
  OutcomeAction,
  Session,
  SessionOutcome,
  StartSessionAction,
} from "@/types/session";
import { useUiStore } from "@/store/uiStore";
import { useSessionStore } from "@/store/sessionStore";
import { useBoardStore } from "@/store/boardStore";
import { useFileStore } from "@/store/fileStore";
import { useNotificationStore } from "@/store/notificationStore";
import { readFile } from "@/services/files";
import { MarkdownPreview } from "@/components/FileViewer/MarkdownPreview";
import { buildDefaultSessionConfig } from "@/utils/sessionConfig";
import { artifactPathCandidates } from "./registry";
import "./WizardDonePanel.css";

interface WizardDonePanelProps {
  session: Session;
  outcome: SessionOutcome;
}

function partitionActions(actions: OutcomeAction[]): {
  primary: StartSessionAction[];
  navigate: NavigateAction[];
  tickets: CreateTicketAction[];
} {
  const primary: StartSessionAction[] = [];
  const navigate: NavigateAction[] = [];
  const tickets: CreateTicketAction[] = [];
  for (const a of actions) {
    switch (a.type) {
      case "start_session":
        primary.push(a);
        break;
      case "navigate":
        navigate.push(a);
        break;
      case "create_ticket":
        tickets.push(a);
        break;
    }
  }
  return { primary, navigate, tickets };
}

export function WizardDonePanel({ session, outcome }: WizardDonePanelProps) {
  const projectPath = useUiStore((s) => s.projectPath);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const dismissWizardOutcome = useUiStore((s) => s.dismissWizardOutcome);
  const startSession = useSessionStore((s) => s.startSession);
  const patchOutcomeAction = useSessionStore((s) => s.patchOutcomeAction);
  const createTicket = useBoardStore((s) => s.createTicket);
  const openFile = useFileStore((s) => s.openFile);

  const { primary, navigate, tickets } = useMemo(
    () => partitionActions(outcome.actions),
    [outcome.actions],
  );

  // The "headline" CTA — first start_session marked primary, else first start_session.
  const heroAction = useMemo<StartSessionAction | null>(() => {
    return primary.find((a) => a.primary) ?? primary[0] ?? null;
  }, [primary]);

  const secondaryStartActions = useMemo(
    () => primary.filter((a) => a !== heroAction),
    [primary, heroAction],
  );

  const firstArtifact = outcome.artifacts.find((a) => a.openOnDone ?? true);

  const [docContent, setDocContent] = useState<string | null>(null);
  useEffect(() => {
    if (!firstArtifact || !projectPath) return;
    let cancelled = false;
    const candidates = artifactPathCandidates(firstArtifact.path);
    (async () => {
      for (const candidate of candidates) {
        try {
          const data = await readFile(projectPath, candidate);
          if (cancelled) return;
          if (data?.content != null) {
            setDocContent(data.content);
            return;
          }
        } catch {
          // try next candidate
        }
      }
      if (!cancelled) setDocContent("");
    })();
    return () => {
      cancelled = true;
    };
  }, [firstArtifact, projectPath]);

  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const sendMessage = useSessionStore((s) => s.sendMessage);

  const handleStart = useCallback(
    async (action: StartSessionAction) => {
      if (busyActionId) return;
      setBusyActionId(action.id);
      try {
        const bonsaiSid = await startSession({
          specIds: [],
          config: await buildDefaultSessionConfig(),
          name: action.title,
          skillId: action.skillId,
        });
        // The runtime creates the task in "initializing" and waits for a
        // user message to begin its conversation loop. Without this kick
        // the session would sit idle forever. Use the action's explicit
        // prompt if the skill provided one; otherwise send a generic
        // "begin" so the new skill takes over and runs its Step 1.
        const opener =
          (action.prompt ?? "").trim() ||
          `Let's start the ${action.title.replace(/^[^a-zA-Z]+/, "")} flow.`;
        await sendMessage(bonsaiSid, opener);
      } finally {
        setBusyActionId(null);
      }
    },
    [busyActionId, startSession, sendMessage],
  );

  const handleNavigate = useCallback(
    (action: NavigateAction) => {
      // The user is opting out of the wizard for this session — they've
      // seen the done-screen and chose a different destination. Mark the
      // outcome as dismissed so re-activating this session (clicking it
      // in the tab bar, or after a page reload) drops them into the
      // regular session UX instead of the done-screen.
      dismissWizardOutcome(session.bonsaiSid);
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
    [setCenterView, dismissWizardOutcome, session.bonsaiSid, openFile, firstArtifact, projectPath],
  );

  const handleAddTicket = useCallback(
    async (action: CreateTicketAction) => {
      if (busyActionId || action.state === "applied") return;
      setBusyActionId(action.id);
      try {
        // Wizard outcome already collected enough context to draft the
        // body; the ticket lands in "described" rather than the default
        // "idea" column so it's visible in the next-action column from
        // the start.
        await createTicket(action.title, action.body ?? undefined, undefined, "product-design");
        await patchOutcomeAction(session.bonsaiSid, action.id, { state: "applied" });
      } finally {
        setBusyActionId(null);
      }
    },
    [busyActionId, createTicket, patchOutcomeAction, session.bonsaiSid],
  );

  const pendingTickets = tickets.filter((t) => t.state !== "applied");
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
          await createTicket(t.title, t.body ?? undefined, undefined, "product-design");
          await patchOutcomeAction(session.bonsaiSid, t.id, { state: "applied" });
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
  }, [busyActionId, pendingTickets, createTicket, patchOutcomeAction, session.bonsaiSid]);

  return (
    <div className="wiz-done">
      {outcome.summary && (
        <div className="wiz-done-banner">
          <span className="wiz-done-banner-icon" aria-hidden="true">🌱</span>
          <span className="wiz-done-banner-text">{outcome.summary}</span>
        </div>
      )}

      {(heroAction || navigate.length > 0 || secondaryStartActions.length > 0) && (
        <div className="wiz-done-next-step-row">
          {heroAction && (
            <button
              type="button"
              className="wiz-done-cta wiz-done-cta--primary"
              onClick={() => handleStart(heroAction)}
              disabled={busyActionId !== null}
            >
              <span className="wiz-done-cta-body">
                <span className="wiz-done-cta-title">{heroAction.title}</span>
                {heroAction.description && (
                  <span className="wiz-done-cta-desc">{heroAction.description}</span>
                )}
              </span>
              <span className="wiz-done-cta-arrow" aria-hidden="true">→</span>
            </button>
          )}
          {secondaryStartActions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="wiz-done-cta wiz-done-cta--alt"
              onClick={() => handleStart(a)}
              disabled={busyActionId !== null}
            >
              <span className="wiz-done-cta-body">
                <span className="wiz-done-cta-title">{a.title}</span>
                {a.description && <span className="wiz-done-cta-desc">{a.description}</span>}
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

      {tickets.length > 0 && (
        <div className="wiz-done-tickets">
          <div className="wiz-done-tickets-head">
            <span className="wiz-done-tickets-title">Suggested tickets</span>
            <span className="wiz-done-tickets-counter">
              <b>{tickets.filter((t) => t.state === "applied").length}</b> of {tickets.length} added to board
            </span>
            {pendingTickets.length > 0 && (
              <button
                type="button"
                className="wiz-done-add-all-btn"
                onClick={handleAddAll}
                disabled={busyActionId !== null}
              >
                + Add all {pendingTickets.length} remaining
              </button>
            )}
          </div>
          <ul className="wiz-done-tickets-list">
            {tickets.map((t) => (
              <li key={t.id} className="wiz-done-tickets-li">
                <span className="wiz-done-tickets-bullet" aria-hidden="true">•</span>
                <span className="wiz-done-tickets-text">
                  <b>{t.title}</b>
                  {t.body && <span className="wiz-done-tickets-body"> — {t.body}</span>}
                </span>
                <button
                  type="button"
                  className={`wiz-done-add-btn${t.state === "applied" ? " wiz-done-add-btn--added" : ""}`}
                  onClick={() => handleAddTicket(t)}
                  disabled={busyActionId !== null || t.state === "applied"}
                >
                  {t.state === "applied" ? "✓ Added" : "+ Add to board"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {firstArtifact && (
        <div className="wiz-done-doc">
          <div className="wiz-done-doc-head">
            <span className="wiz-done-doc-pill">{firstArtifact.path.replace(/^\.bonsai\//, "")}</span>
            {firstArtifact.label && <span className="wiz-done-doc-label">{firstArtifact.label}</span>}
          </div>
          <div className="wiz-done-doc-body">
            {docContent == null ? (
              <p className="wiz-done-doc-loading">Loading…</p>
            ) : docContent === "" ? (
              <p className="wiz-done-doc-loading">No content yet.</p>
            ) : (
              <MarkdownPreview content={docContent} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
