import { useEffect, useState } from "react";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { useActiveSession } from "../useActiveSession.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { MarkdownPreview } from "@/components/FileViewer/MarkdownPreview.tsx";
import "./TaskSpecPreview.css";

export function TaskSpecPreview() {
  const session = useActiveSession();
  const specs = useSpecStore((s) => s.specs);
  const fetchSpecContent = useSpecStore((s) => s.fetchSpecContent);
  const loadPreview = useFileStore((s) => s.loadPreview);

  const primarySpecId = session?.specIds[0] ?? null;
  const specEntry = primarySpecId ? specs.find((s) => s.id === primarySpecId) : null;

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!primarySpecId) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSpecContent(primarySpecId).then((c) => {
      if (!cancelled) {
        setContent(c);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [primarySpecId, fetchSpecContent]);

  return (
    <CollapsibleSection
      title="Task Spec"
      summary={specEntry?.title}
      expandToCenter={specEntry ? () => loadPreview(specEntry.path) : undefined}
    >
      <div className="task-spec-preview">
        {loading ? (
          <div className="section-placeholder">Loading...</div>
        ) : content ? (
          <MarkdownPreview content={content} />
        ) : (
          <div className="section-placeholder">No task spec assigned to this session</div>
        )}
      </div>
    </CollapsibleSection>
  );
}
