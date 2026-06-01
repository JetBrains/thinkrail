import { useCallback, useEffect, useState } from "react";
import { initEngine, scanProject, type ProjectScan } from "@/services/project.ts";

export interface UseProjectScan {
  /** Latest scan result, or ``null`` until the first scan resolves. */
  scan: ProjectScan | null;
  /** Last scan error message, if any (initial scan only — init-engine
   *  errors live in {@link initError}). */
  error: string | null;
  /** Set of paths (file name OR top-folder name OR engine guidance
   *  file) currently checked for inclusion. */
  selected: Set<string>;
  /** Toggle a single path on/off in the selection. */
  toggle: (key: string) => void;
  /** Engines whose ``Init`` button is mid-flight. */
  initBusy: Set<string>;
  /** Latest init-engine error message, if any. */
  initError: string | null;
  /** Run the engine's init command, then re-scan and add the newly
   *  found guidance file to {@link selected}. */
  initEngineFor: (engine: string) => Promise<void>;
}

/**
 * Encapsulates the detect-screen's read-side state: scan result,
 * default selections, toggling, and the ``Init agent`` flow. Pure
 * logic — no React rendering. The component using this hook owns
 * presentation only.
 */
export function useProjectScan(projectPath: string | null): UseProjectScan {
  const [scan, setScan] = useState<ProjectScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initBusy, setInitBusy] = useState<Set<string>>(new Set());
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    scanProject(projectPath)
      .then((data) => {
        if (cancelled) return;
        setScan(data);
        setSelected(defaultSelectionFor(data));
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message ?? "Failed to scan project");
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const initEngineFor = useCallback(
    async (engine: string) => {
      if (!projectPath) return;
      setInitError(null);
      setInitBusy((prev) => new Set(prev).add(engine));
      try {
        await initEngine(engine, projectPath);
        const fresh = await scanProject(projectPath);
        setScan(fresh);
        // Pick up the newly-found guidance file without losing the
        // user's other deselections.
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

  return { scan, error, selected, toggle, initBusy, initError, initEngineFor };
}

function defaultSelectionFor(data: ProjectScan): Set<string> {
  const initial = new Set<string>();
  data.important_files.forEach((f) => initial.add(f.name));
  data.top_folders.forEach((f) => initial.add(f.name));
  data.engine_guidance.forEach((g) => g.found && initial.add(g.file));
  return initial;
}
