import { useCallback, useEffect, useState, type ReactNode } from "react";
import { initEngine, scanProject, type ProjectScan } from "@/services/project.ts";
import type { ScanEngineGuidance } from "@/api/rest.ts";
import { formatBytes } from "@/utils/format.ts";
import { WizardStepper } from "@/components/Wizard/WizardStepper.tsx";
import type { WizardStep } from "@/components/Wizard/registry.ts";
import "@/components/Wizard/NewProjectForm.css";
import "./ExistingProjectDetect.css";

interface ExistingProjectDetectProps {
  projectPath: string;
  projectName: string;
  onCancel: () => void;
  onContinue: (selectedKeys: string[]) => void;
}

const STEPPER_STEPS: WizardStep[] = [
  { label: "Read repo", status: "active" },
  { label: "Investigate", status: "pending" },
  { label: "Goal & Requirements", status: "pending" },
  { label: "Design doc", status: "pending" },
];

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

export function ExistingProjectDetect({
  projectPath,
  projectName,
  onCancel,
  onContinue,
}: ExistingProjectDetectProps) {
  const [scan, setScan] = useState<ProjectScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initBusy, setInitBusy] = useState<Set<string>>(new Set());
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    scanProject(projectPath)
      .then((data) => {
        if (cancelled) return;
        setScan(data);
        const initial = new Set<string>();
        data.important_files.forEach((f) => initial.add(f.name));
        data.top_folders.forEach((f) => initial.add(f.name));
        data.engine_guidance.forEach((g) => g.found && initial.add(g.file));
        setSelected(initial);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message ?? "Failed to scan project");
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleInit = useCallback(
    async (engine: string) => {
      setInitError(null);
      setInitBusy((prev) => new Set(prev).add(engine));
      try {
        await initEngine(engine, projectPath);
        const fresh = await scanProject(projectPath);
        setScan(fresh);
        setSelected((prev) => {
          const next = new Set(prev);
          fresh.engine_guidance.forEach((g) => g.found && next.add(g.file));
          return next;
        });
      } catch (e) {
        setInitError((e as Error).message ?? "Failed to init engine");
      } finally {
        setInitBusy((prev) => {
          const next = new Set(prev);
          next.delete(engine);
          return next;
        });
      }
    },
    [projectPath],
  );

  if (error) {
    return (
      <div className="detect-screen">
        <WizardStepper steps={STEPPER_STEPS} />
        <div className="np-form detect-form">
          <p className="detect-error">{error}</p>
          <button className="np-form-btn" onClick={onCancel}>Back</button>
        </div>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="detect-screen">
        <WizardStepper steps={STEPPER_STEPS} />
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
      <WizardStepper steps={STEPPER_STEPS} />

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
                        onClick={() => handleInit(g.engine)}
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

        <div className="np-form-actions">
          <span className="np-form-hint">
            ✓ {selected.size} of {totalSelectable} selected
          </span>
          <div className="np-form-actions-buttons">
            <button className="np-form-btn" onClick={onCancel} type="button">
              Cancel
            </button>
            <button
              className="np-form-btn np-form-btn-primary"
              onClick={() => onContinue(Array.from(selected))}
              disabled={selected.size === 0}
              type="button"
              title="Investigation flow is not implemented yet"
            >
              Start investigation
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
