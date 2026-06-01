import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { ScanEngineGuidance } from "@/api/rest.ts";
import { formatBytes } from "@/utils/format.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { WizardStepper } from "@/components/Wizard/WizardStepper.tsx";
import { getWizardConfig, entryTransition } from "@/components/Wizard/registry.ts";
import { useStartWizardStep } from "@/components/Wizard/useStartWizardStep.ts";
import { derivePhase } from "@/components/Wizard/phase.ts";
import { useProjectScan } from "./useProjectScan.ts";
import "@/components/Wizard/NewProjectForm.css";
import "./ExistingProjectDetect.css";

// This chain's identity. The skill + the session_prompt builder both
// come from the wizard registry (single source) — the page only
// collects inputs (selected files) and hands them to the registry's
// entry transition. All agent instructions live in the skill's SKILL.md.
const CHAIN_ID = "investigate-project";
const ENTRY = entryTransition(CHAIN_ID);

interface DetectRowProps {
  icon: string;
  name: string;
  description: ReactNode;
  action: ReactNode;
  missing?: boolean;
}

function DetectRow({ icon, name, description, action, missing }: DetectRowProps) {
  return (
    <div className={`detect-row ${missing ? "detect-row-missing" : ""}`}>
      <div className="detect-row-icon">{icon}</div>
      <div className="detect-row-info">
        <div className="detect-row-name">{name}</div>
        <div className="detect-row-desc">{description}</div>
      </div>
      {action}
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

  // This screen is the pre-chat phase of investigate-project —
  // derivePhase(null) returns "pre-chat", and the registry resolves
  // that to "What we'll read":active. Phase is NEVER hardcoded.
  // The chain hint is required because the wizard registry computes
  // the stepper based on the chain — without it, ambiguous skills
  // would fall back to their default chain.
  const stepperSteps =
    getWizardConfig(CHAIN_ID, derivePhase({ session: null }), CHAIN_ID)
      ?.steps ?? [];

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

  if (!projectPath) {
    return null;
  }

  if (error) {
    return (
      <div className="detect-screen">
        <WizardStepper steps={stepperSteps} />
        <div className="np-form detect-form">
          <p className="detect-error">{error}</p>
          <button className="np-form-btn" onClick={handleCancel}>Back</button>
        </div>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="detect-screen">
        <WizardStepper steps={stepperSteps} />
        <div className="np-form detect-form">
          <p className="np-form-lead">Scanning {projectName}…</p>
        </div>
      </div>
    );
  }

  const totalSelectable =
    scan.important_files.length +
    scan.top_folders.length +
    scan.engine_guidance.filter((g) => g.found).length;

  return (
    <div className="detect-screen">
      <WizardStepper steps={stepperSteps} />

      <div className="np-form detect-form">
        <header className="detect-project-header">
          <div className="detect-project-info">
            <svg className="detect-leaf" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22V11" />
              <path d="M5 11c0-4 3-7 7-7s7 3 7 7c0 4-3 7-7 7s-7-3-7-7Z" />
            </svg>
            <div>
              <div className="detect-project-name">{projectName}</div>
              <div className="detect-project-path">{projectPath}</div>
            </div>
          </div>
          <span className="detect-pill">No <code>.bonsai/</code> yet</span>
        </header>

        <h2 className="np-form-h2">What I’ll read first</h2>
        <p className="np-form-lead">
          Bonsai will read these files to figure out what this project is. Deselect anything you’d rather skip.
        </p>

        <div className="detect-list-scroll">
          {scan.engine_guidance.length > 0 && (
            <>
              <div className="np-form-label detect-section-label">Agent guidance</div>
              {scan.engine_guidance.map((g) => (
                <DetectRow
                  key={g.engine}
                  icon={g.found ? "🤖" : "⚠️"}
                  name={g.file}
                  description={engineDescription(g)}
                  missing={!g.found}
                  action={
                    g.found ? (
                      <input
                        type="checkbox"
                        checked={selected.has(g.file)}
                        onChange={() => toggle(g.file)}
                        aria-label={`Include ${g.file}`}
                      />
                    ) : (
                      <button
                        className="detect-init-btn"
                        onClick={() => initEngineFor(g.engine)}
                        disabled={initBusy.has(g.engine)}
                      >
                        {initBusy.has(g.engine) ? "Creating…" : `Init ${g.display_name}`}
                      </button>
                    )
                  }
                />
              ))}
              {initError && <p className="detect-error">{initError}</p>}
            </>
          )}

          <div className="np-form-label detect-section-label">
            Files {scan.important_files.length > 0 && `· ${scan.important_files.length}`}
          </div>
          {scan.important_files.length === 0 ? (
            <p className="detect-empty">No high-signal files at the project root.</p>
          ) : (
            scan.important_files.map((f) => (
              <DetectRow
                key={f.name}
                icon="📄"
                name={f.name}
                description={`${f.description} · ${formatBytes(f.size)}`}
                action={
                  <input
                    type="checkbox"
                    checked={selected.has(f.name)}
                    onChange={() => toggle(f.name)}
                    aria-label={`Include ${f.name}`}
                  />
                }
              />
            ))
          )}

          <div className="np-form-label detect-section-label">
            Folders {scan.top_folders.length > 0 && `· ${scan.top_folders.length}`}
          </div>
          {scan.top_folders.length === 0 ? (
            <p className="detect-empty">No top-level folders.</p>
          ) : (
            scan.top_folders.map((f) => (
              <DetectRow
                key={f.name}
                icon="📁"
                name={`${f.name}/`}
                description={`${f.entry_count} ${f.entry_count === 1 ? "entry" : "entries"}`}
                action={
                  <input
                    type="checkbox"
                    checked={selected.has(f.name)}
                    onChange={() => toggle(f.name)}
                    aria-label={`Include folder ${f.name}`}
                  />
                }
              />
            ))
          )}
        </div>

        {startError && <p className="detect-error">{startError}</p>}

        <div className="np-form-actions">
          <span className="np-form-hint">
            ✓ {selected.size} of {totalSelectable} selected
          </span>
          <div className="np-form-actions-buttons">
            <button className="np-form-btn" onClick={handleCancel} disabled={submitting} type="button">
              Cancel
            </button>
            <button
              className="np-form-btn np-form-btn-primary"
              onClick={handleStart}
              disabled={submitting || selected.size === 0}
              type="button"
            >
              {submitting ? "Starting…" : "Start investigation"}
              <svg className="np-form-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
