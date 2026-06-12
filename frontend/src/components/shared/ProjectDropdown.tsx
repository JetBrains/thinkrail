import { useEffect, useState } from "react";
import { Grid2x2 } from "lucide-react";
import { getKnownProjects, type KnownProject } from "@/services/projects.ts";
import { validateProject } from "@/services/project.ts";
import "./ProjectDropdown.css";

interface ProjectDropdownProps {
  onSelectProject: (path: string) => void;
  onClose: () => void;
}

export function ProjectDropdown({ onSelectProject, onClose }: ProjectDropdownProps) {
  const [recents, setRecents] = useState<KnownProject[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getKnownProjects()
      .then(setRecents)
      .catch(() => setRecents([]));
  }, []);

  const handleOpen = async (projectPath: string) => {
    setLoading(true);
    try {
      const validateData = await validateProject(projectPath);
      if (validateData.exists) {
        onSelectProject(validateData.path);
        onClose();
      }
    } catch {
      // Ignore errors - user can try again
    } finally {
      setLoading(false);
    }
  };

  if (recents.length === 0) {
    return (
      <div className="project-dropdown">
        <div className="project-dropdown-empty">No recent projects</div>
      </div>
    );
  }

  return (
    <div className="project-dropdown">
      {recents.map((r) => (
        <button
          key={r.path}
          className="project-dropdown-item"
          onClick={() => handleOpen(r.path)}
          disabled={loading}
        >
          <Grid2x2 size={16} strokeWidth={1.5} className="project-dropdown-icon" />
          <div className="project-dropdown-info">
            <div className="project-dropdown-name">{r.name}</div>
            <div className="project-dropdown-path">{r.path}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
