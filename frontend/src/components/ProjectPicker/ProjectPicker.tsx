import { useCallback, useEffect, useState } from "react";
import { Grid2x2Plus, FolderHeart, Grid2x2 } from "lucide-react";
import { validateProject } from "@/services/project.ts";
import { browseFolder, getDefaultRoot } from "@/services/fs.ts";
import {
  getKnownProjects,
  type KnownProject,
} from "@/services/projects.ts";
import { NewProjectForm } from "@/components/Wizard/NewProjectForm";
import { PRODUCT_NAME } from "@/constants/branding";
import "./ProjectPicker.css";

interface ProjectPickerProps {
  onSelect: (path: string) => void;
  onClose?: () => void;
}

export function ProjectPicker({ onSelect, onClose }: ProjectPickerProps) {
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<KnownProject[]>([]);
  const [mode, setMode] = useState<"welcome" | "new">("welcome");
  const [defaultRoot, setDefaultRoot] = useState("");

  useEffect(() => {
    getKnownProjects()
      .then(setRecents)
      .catch(() => setRecents([]));
    getDefaultRoot()
      .then(setDefaultRoot)
      .catch(() => setDefaultRoot(""));
  }, []);

  const handleOpen = useCallback(
    async (projectPath: string) => {
      setLoading(true);
      try {
        const validateData = await validateProject(projectPath);
        if (validateData.exists) {
          onSelect(validateData.path);
        }
      } catch {
        // Ignore errors - user can try again
      } finally {
        setLoading(false);
      }
    },
    [onSelect],
  );

  const openBrowse = useCallback(async () => {
    try {
      const data = await browseFolder();
      if (data?.path) {
        await handleOpen(data.path);
      }
    } catch {
      // user cancelled or backend unreachable; stay on welcome
    }
  }, [handleOpen]);

  if (mode === "new") {
    return (
      <NewProjectForm
        mode="create"
        defaultRoot={defaultRoot}
        onSelect={onSelect}
        onCancel={() => setMode("welcome")}
      />
    );
  }

  return (
    <div className={`picker-container ${onClose ? "picker-modal" : ""}`} onClick={onClose}>
      <div className="picker-welcome" onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button className="picker-close" onClick={onClose}>{"×"}</button>
        )}

        <div className="picker-hero">
          <h1 className="picker-h1">Welcome to {PRODUCT_NAME}</h1>
          <p className="picker-tagline">
            Spec-driven development for AI agents. Grow software with intent — one ticket at a time.
          </p>

          <div className="picker-ctas">
            <button
              className="picker-cta picker-cta-primary"
              onClick={() => setMode("new")}
              disabled={loading}
            >
              <span className="picker-cta-h">
                <Grid2x2Plus size={16} strokeWidth={1.5} />
                Start a new project
              </span>
              <span className="picker-cta-s">Idea → Goal &amp; Requirements doc</span>
            </button>
            <button
              className="picker-cta"
              onClick={openBrowse}
              disabled={loading}
            >
              <span className="picker-cta-h">
                <FolderHeart size={16} strokeWidth={1.5} />
                Open an existing project
              </span>
              <span className="picker-cta-s">{PRODUCT_NAME} will investigate the code with you</span>
            </button>
          </div>
        </div>

        <div className={`picker-recents ${recents.length === 0 ? "picker-recents--empty" : ""}`}>
          <div className="picker-recents-head">
            <h4 className="picker-recents-label">Recent</h4>
            <div className="picker-recents-rule" />
          </div>
          {recents.length > 0 ? (
            <div className="picker-recents-list">
              {recents.map((r) => (
                <button
                  key={r.path}
                  className="picker-recent-item"
                  onClick={() => handleOpen(r.path)}
                >
                  <Grid2x2 size={16} strokeWidth={1.5} className="picker-leaf" />
                  <div className="picker-recent-info">
                    <div className="picker-recent-name">{r.name}</div>
                    <div className="picker-recent-path">{r.path}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="picker-recents-empty">No recent projects</div>
          )}
        </div>
      </div>
    </div>
  );
}
