import { useMemo } from "react";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { useActiveSession } from "../useActiveSession.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { fileName, dirName } from "../utils.tsx";
import "./FilesModified.css";

const CHANGE_CONFIG = {
  created:  { badge: "C", label: "Created" },
  modified: { badge: "M", label: "Modified" },
  deleted:  { badge: "D", label: "Deleted" },
} as const;

type ChangeType = keyof typeof CHANGE_CONFIG;
const CHANGE_ORDER: ChangeType[] = ["created", "modified", "deleted"];

export function FilesModified() {
  const session = useActiveSession();
  const loadPreview = useFileStore((s) => s.loadPreview);

  const groups = useMemo(() => {
    const filesChanged = session?.metrics.filesChanged ?? {};
    const grouped: Record<ChangeType, string[]> = { created: [], modified: [], deleted: [] };

    for (const [path, type] of Object.entries(filesChanged)) {
      if (grouped[type]) grouped[type].push(path);
    }

    for (const type of CHANGE_ORDER) {
      grouped[type].sort();
    }

    return CHANGE_ORDER
      .filter((type) => grouped[type].length > 0)
      .map((type) => ({ type, files: grouped[type] }));
  }, [session?.metrics.filesChanged]);

  const totalCount = groups.reduce((sum, g) => sum + g.files.length, 0);

  return (
    <CollapsibleSection title="Files Modified" count={totalCount || undefined}>
      {groups.length === 0 ? (
        <div className="section-placeholder">No files modified yet</div>
      ) : (
        groups.map((group) => (
          <div key={group.type} className="files-group">
            <div className="files-group__label">
              <span className="files-group__badge" data-change={group.type}>
                {CHANGE_CONFIG[group.type].badge}
              </span>
              {CHANGE_CONFIG[group.type].label} ({group.files.length})
            </div>
            {group.files.map((path) => (
              <button
                key={path}
                className="files-item"
                onClick={() => loadPreview(path)}
              >
                {fileName(path)}
                <span className="files-item__dir">{dirName(path)}</span>
              </button>
            ))}
          </div>
        ))
      )}
    </CollapsibleSection>
  );
}
