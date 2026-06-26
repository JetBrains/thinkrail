import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { File, Folder, Bot, ArrowLeft, FileText, MessagesSquare, ScanSearch, ChevronRight } from "lucide-react";
import type { ScanEngineGuidance } from "@/api/rest.ts";
import { formatBytes } from "@/utils/format.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { entryTransition } from "@/components/Wizard/registry.ts";
import { useStartWizardStep } from "@/components/Wizard/useStartWizardStep.ts";
import { FullScreenLayout } from "@/components/Wizard/FullScreenLayout";
import { useProjectScan } from "./useProjectScan.ts";
import { Button } from "@/components/ui/Button";
import "@/components/Wizard/NewProjectForm.css";
import "./ExistingProjectDetect.css";

// This chain's identity. The skill + the session_prompt builder both
// come from the wizard registry (single source) — the page only
// collects inputs (selected files) and hands them to the registry's
// entry transition. All agent instructions live in the skill's SKILL.md.
const CHAIN_ID = "investigate-project";
const ENTRY = entryTransition(CHAIN_ID);

interface DetectRowProps {
  icon: ReactNode;
  name: string;
  description: ReactNode;
  checked?: boolean;
  onToggle?: () => void;
  action?: ReactNode;
  missing?: boolean;
}

function DetectRow({ icon, name, description, checked, onToggle, action, missing }: DetectRowProps) {
  const handleClick = useCallback(() => {
    if (onToggle && !missing) {
      onToggle();
    }
  }, [onToggle, missing]);

  const classNames = [
    "detect-row",
    missing && "detect-row-missing",
    onToggle && !missing && "detect-row-clickable",
    checked && "detect-row-selected",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={classNames}
      onClick={handleClick}
      role={onToggle && !missing ? "checkbox" : undefined}
      aria-checked={onToggle && !missing ? checked : undefined}
      tabIndex={onToggle && !missing ? 0 : undefined}
    >
      <div className="detect-row-icon">{icon}</div>
      <div className="detect-row-info">
        <div className="detect-row-name">{name}</div>
        <div className="detect-row-desc">{description}</div>
      </div>
      {action || (onToggle && !missing && (
        <div className={`detect-checkbox ${checked ? "detect-checkbox-checked" : ""}`}>
          {checked && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

function engineDescription(g: ScanEngineGuidance): ReactNode {
  if (g.found) return `${g.display_name} guidance — already in repo`;
  if (g.init_command) {
    return (
      <>
        Missing — click <b>Init agent</b> to create a starter file, or run{" "}
        <code>{g.init_command}</code> for {g.display_name} to fill it in.
      </>
    );
  }
  return `${g.display_name} guidance not found`;
}

export function ExistingProjectDetect() {
  const navigate = useNavigate();
  const projectPath = useUiStore((s) => s.projectPath);
  const projectName = useUiStore((s) => s.projectName);
  const setProjectState = useUiStore((s) => s.setProjectState);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const setCurrentChain = useUiStore((s) => s.setCurrentChain);
  const startWizardStep = useStartWizardStep();

  // Pin the wizard chain so AppShell renders the correct stepper
  // labels ("What we'll read / Investigation / Clarify / Verify &
  // save") for every subsequent session in this flow.
  useEffect(() => {
    setCurrentChain("investigate-project");
  }, [setCurrentChain]);

  const { scan, error, selected, toggle, initBusy, initError, initEngineFor } =
    useProjectScan(projectPath);

  const [submitting, setSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);

  const handleStart = useCallback(async () => {
    if (!scan || submitting) return;
    setStartError(null);
    setSubmitting(true);
    setProjectState("initialized");
    // Wizard takeovers gate on ``centerView === "sessions"`` in
    // AppShell — without this the chat+doc layout never renders even
    // after the session starts. Same as NewProjectForm.
    setCenterView("sessions");

    // The investigation instructions live in `session_prompt`
    // (rendered into the agent's "## Your Task" section of the system
    // prompt — see backend/app/agent/context.py). The first user
    // message is just a short kick so the conversational loop starts;
    // the actual instructions are persistent and don't pollute the
    // chat transcript.
    const sessionPrompt = ENTRY?.buildPrompt?.({
      projectName,
      selectedPaths: Array.from(selected),
    });

    try {
      await startWizardStep({
        skillId: ENTRY?.target ?? CHAIN_ID,
        chainId: CHAIN_ID,
        name: projectName,
        prompt: sessionPrompt,
        kick: "Begin investigation.",
      });
    } catch (e) {
      setProjectState("existing");
      setSubmitting(false);
      setStartError((e as Error).message ?? "Failed to start session");
    }
  }, [scan, submitting, selected, projectName, setProjectState, setCenterView, startWizardStep]);

  const handleCancel = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // Escape hatch: skip the investigation and drop straight onto the board.
  // Marking the project ``initialized`` clears the pre-chat takeover (the
  // detect screen) and the board view renders. This is in-memory only —
  // until a deliverable (ticket/spec) lands on disk the backend still
  // classifies the dir as ``existing``, so a reload before any work
  // re-offers onboarding.
  const handleSkip = useCallback(() => {
    setProjectState("initialized");
    setCenterView("board");
  }, [setProjectState, setCenterView]);

  if (!projectPath) {
    return null;
  }

  if (error) {
    return (
      <FullScreenLayout maxWidth={700}>
        <p className="detect-error">{error}</p>
        <Button onClick={handleCancel}>Back</Button>
      </FullScreenLayout>
    );
  }

  if (!scan) {
    return (
      <FullScreenLayout maxWidth={700}>
        <p className="np-form-lead">Scanning {projectName}…</p>
      </FullScreenLayout>
    );
  }

  // Group counts shown in the collapsed headers — total, and a "N/M"
  // form once the user deselects some so the header reflects the trim.
  const fileCount = scan.important_files.length;
  const folderCount = scan.top_folders.length;
  const filesSelected = scan.important_files.filter((f) => selected.has(f.name)).length;
  const foldersSelected = scan.top_folders.filter((f) => selected.has(f.name)).length;
  const fileCountLabel = filesSelected === fileCount ? `${fileCount}` : `${filesSelected}/${fileCount}`;
  const folderCountLabel =
    foldersSelected === folderCount ? `${folderCount}` : `${foldersSelected}/${folderCount}`;

  return (
    <FullScreenLayout maxWidth={620}>
      <div className="detect-form">
        <button
          type="button"
          className="detect-back"
          onClick={handleCancel}
          disabled={submitting}
          aria-label="Back to project picker"
        >
          <ArrowLeft size={16} strokeWidth={2} />
          <span>Back</span>
        </button>

        <div className="np-form-header">
          <h2 className="np-form-h2">Set up {projectName}</h2>
          <p className="np-form-lead">
            Before we build or improve anything, let's map what's already here
            and agree on where it's headed.
          </p>
          <ol className="detect-flow">
            <li className="detect-flow-step">
              <span className="detect-flow-num">1</span>
              <File size={16} strokeWidth={1.5} />
              <span>Read project</span>
            </li>
            <li className="detect-flow-step">
              <span className="detect-flow-num">2</span>
              <MessagesSquare size={16} strokeWidth={1.5} />
              <span>Discuss project</span>
            </li>
            <li className="detect-flow-step">
              <span className="detect-flow-num">3</span>
              <FileText size={16} strokeWidth={1.5} />
              <span>Design doc + goals</span>
            </li>
          </ol>
        </div>

        {startError && <p className="detect-error">{startError}</p>}

        <div className="detect-cta-row">
          <button
            type="button"
            className="detect-cta detect-cta--skip"
            onClick={handleSkip}
            disabled={submitting}
          >
            <span className="detect-cta-body">
              <span className="detect-cta-title">Skip to board</span>
              <span className="detect-cta-sub">
                Jump straight in and start creating tickets.
              </span>
            </span>
          </button>

          <button
            type="button"
            className="detect-cta detect-cta--primary"
            onClick={handleStart}
            disabled={submitting || selected.size === 0}
          >
            <span className="detect-cta-icon" aria-hidden="true">
              <ScanSearch size={20} strokeWidth={1.5} />
            </span>
            <span className="detect-cta-body">
              <span className="detect-cta-title">
                {submitting ? "Starting…" : "Start discussion"}
              </span>
              <span className="detect-cta-sub">
                I learn how it works, we talk it through, and capture the outcome
                as Markdown docs plus a clear set of tasks.
              </span>
            </span>
          </button>
        </div>

        <div className="detect-read">
          <div className="detect-read-label">What I'll read</div>

          {scan.engine_guidance.length > 0 && (
            <div className="detect-guidance">
              {scan.engine_guidance.map((g) => (
                <DetectRow
                  key={g.engine}
                  icon={g.found ? <Bot size={16} strokeWidth={1.5} /> : "⚠️"}
                  name={g.file}
                  description={engineDescription(g)}
                  missing={!g.found}
                  checked={g.found ? selected.has(g.file) : undefined}
                  onToggle={g.found ? () => toggle(g.file) : undefined}
                  action={
                    !g.found ? (
                      <button
                        className="detect-init-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          initEngineFor(g.engine);
                        }}
                        disabled={initBusy.has(g.engine)}
                      >
                        {initBusy.has(g.engine) ? "Creating…" : `Init ${g.display_name}`}
                      </button>
                    ) : undefined
                  }
                />
              ))}
              {initError && <p className="detect-error">{initError}</p>}
            </div>
          )}

          <div className={`detect-group${filesOpen ? " detect-group--open" : ""}`}>
            <button
              type="button"
              className="detect-group-toggle"
              onClick={() => setFilesOpen((o) => !o)}
              aria-expanded={filesOpen}
              disabled={fileCount === 0}
            >
              <ChevronRight
                size={15}
                className={`detect-group-chevron${filesOpen ? " detect-group-chevron--open" : ""}`}
              />
              <File size={15} strokeWidth={1.5} />
              <span>Files</span>
              <span className="detect-group-count">{fileCountLabel}</span>
            </button>
            {filesOpen && (
              <div className="detect-group-body">
                {fileCount === 0 ? (
                  <p className="detect-empty">No high-signal files at the project root.</p>
                ) : (
                  scan.important_files.map((f) => (
                    <DetectRow
                      key={f.name}
                      icon={<File size={16} strokeWidth={1.5} />}
                      name={f.name}
                      description={`${f.description} · ${formatBytes(f.size)}`}
                      checked={selected.has(f.name)}
                      onToggle={() => toggle(f.name)}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          <div className={`detect-group${foldersOpen ? " detect-group--open" : ""}`}>
            <button
              type="button"
              className="detect-group-toggle"
              onClick={() => setFoldersOpen((o) => !o)}
              aria-expanded={foldersOpen}
              disabled={folderCount === 0}
            >
              <ChevronRight
                size={15}
                className={`detect-group-chevron${foldersOpen ? " detect-group-chevron--open" : ""}`}
              />
              <Folder size={15} strokeWidth={1.5} />
              <span>Folders</span>
              <span className="detect-group-count">{folderCountLabel}</span>
            </button>
            {foldersOpen && (
              <div className="detect-group-body">
                {folderCount === 0 ? (
                  <p className="detect-empty">No top-level folders.</p>
                ) : (
                  scan.top_folders.map((f) => (
                    <DetectRow
                      key={f.name}
                      icon={<Folder size={16} strokeWidth={1.5} />}
                      name={`${f.name}/`}
                      description={`${f.entry_count} ${f.entry_count === 1 ? "entry" : "entries"}`}
                      checked={selected.has(f.name)}
                      onToggle={() => toggle(f.name)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </FullScreenLayout>
  );
}
