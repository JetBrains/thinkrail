import { useSessionStore } from "@/store/sessionStore.ts";
import { ArtifactStrip } from "./ArtifactStrip.tsx";
import { PreviewBody } from "./PreviewBody.tsx";

export function PreviewTab() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const session = useSessionStore(
    (s) => (activeSessionId ? s.sessions.get(activeSessionId) ?? null : null),
  );
  const setPreviewPath = useSessionStore((s) => s.setPreviewPath);

  if (!session) return null;

  // Default focus: explicit preview if set, else first artifact, else nothing.
  const activePath = session.previewPath ?? session.artifacts[0]?.path ?? null;

  if (!activePath) {
    return (
      <div className="cp-preview-loading">
        No artifact yet. The agent will fill this as it works.
      </div>
    );
  }

  const activeArtifact = session.artifacts.find((a) => a.path === activePath);
  // lastTouchedAt bumps whenever the artifact is re-touched, so PreviewBody
  // re-fetches on each write (complements its own file/didChange subscription).
  const version = activeArtifact?.lastTouchedAt ?? null;

  return (
    <div className="cp-preview-tab">
      <ArtifactStrip
        artifacts={session.artifacts}
        activePath={activePath}
        onSelect={(p) => setPreviewPath(session.thinkrailSid, p)}
      />
      <PreviewBody
        path={activePath}
        section={session.previewSection}
        version={version}
      />
    </div>
  );
}
