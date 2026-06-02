import type { SessionArtifact } from "@/types/agent.ts";
import "./ArtifactStrip.css";

const KIND_MARKS: Record<SessionArtifact["kind"], string> = {
  write: "+",
  edit: "~",
  "propose-change": "≈",
  preview: "●",
};

interface Props {
  artifacts: SessionArtifact[];
  activePath: string | null;
  onSelect: (path: string) => void;
}

export function ArtifactStrip({ artifacts, activePath, onSelect }: Props) {
  if (artifacts.length === 0) return null;
  return (
    <div className="artifact-strip" role="tablist">
      {artifacts.map((a) => {
        const isActive = a.path === activePath;
        const display = a.label ?? a.path.split("/").pop() ?? a.path;
        return (
          <button
            key={a.path}
            role="tab"
            aria-selected={isActive}
            title={a.path}
            className={`artifact-chip${isActive ? " artifact-chip--active" : ""}`}
            onClick={() => onSelect(a.path)}
          >
            <span className="artifact-chip__kind">{KIND_MARKS[a.kind]}</span>
            {display}
          </button>
        );
      })}
    </div>
  );
}
