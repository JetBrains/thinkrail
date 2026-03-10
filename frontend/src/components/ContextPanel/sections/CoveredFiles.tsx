import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { useSelectedSpec } from "../useSelectedSpec.ts";
import { useFileStore } from "@/store/fileStore.ts";
import "./CoveredFiles.css";

export function CoveredFiles() {
  const spec = useSelectedSpec();
  const openFile = useFileStore((s) => s.openFile);
  const loadPreview = useFileStore((s) => s.loadPreview);

  if (!spec || !spec.covers?.length) {
    return (
      <CollapsibleSection title="Covered Files">
        <div className="section-placeholder">
          {spec ? "No coverage patterns defined" : "Select a spec to see covered files"}
        </div>
      </CollapsibleSection>
    );
  }

  const covers = spec.covers;

  return (
    <CollapsibleSection title="Covered Files" count={covers.length}>
      <div className="covered-files">
        {covers.map((pattern) => {
          const isDir = pattern.endsWith("/");
          return (
            <button
              key={pattern}
              className="covered-files__item"
              onClick={() => isDir ? undefined : loadPreview(pattern)}
              onDoubleClick={() => isDir ? undefined : openFile(pattern)}
              title={pattern}
            >
              <span className="covered-files__icon">{isDir ? "📁" : "📄"}</span>
              <span className="covered-files__path">{pattern}</span>
            </button>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
