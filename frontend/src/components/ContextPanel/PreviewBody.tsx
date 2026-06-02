import { useEffect, useRef, useState } from "react";
import { useUiStore } from "@/store/uiStore.ts";
import { useSessionStore, selectProposeChangesByFile } from "@/store/sessionStore.ts";
import { readFile } from "@/services/files.ts";
import { MarkdownPreview } from "@/components/FileViewer/MarkdownPreview.tsx";
import { ReviewPanel } from "./ReviewPanel.tsx";
import type { ProposeChangeResponse } from "./Hunk.tsx";

interface Props {
  path: string;
  section: string | null;
  /** Bumped whenever the artifact's lastTouchedAt changes; triggers re-fetch. */
  version?: string | null;
}

export function PreviewBody({ path, section, version }: Props) {
  const project = useUiStore((s) => s.projectPath);
  const activeReview = useUiStore((s) => s.activeReview);
  const setActiveReview = useUiStore((s) => s.setActiveReview);
  const sessions = useSessionStore((s) => s.sessions);
  const resolveRequest = useSessionStore((s) => s.resolveRequest);

  const [content, setContent] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    if (prevPathRef.current !== path) {
      setContent(null);
      setWaiting(false);
      prevPathRef.current = path;
    }

    // SetPreviewFile may be called *before* the agent writes the file (e.g.,
    // skill announces the preview, then writes content). The first fetch
    // returns null. Retry every 500ms for up to ~10s so the content shows
    // as soon as the file appears, without waiting for the next mutation
    // to bump the version prop.
    let attempt = 0;
    const maxAttempts = 20; // 20 × 500ms = ~10s
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tryFetch = async () => {
      if (cancelled) return;
      attempt += 1;
      try {
        const data = await readFile(project, path);
        if (cancelled) return;
        if (data) {
          setContent(data.content);
          setWaiting(false);
          return;
        }
        // File not on disk yet → schedule a retry.
        if (attempt < maxAttempts) {
          setWaiting(true);
          timer = setTimeout(tryFetch, 500);
        } else {
          setWaiting(false);
          setContent("");
        }
      } catch {
        if (!cancelled) {
          setWaiting(false);
          setContent("");
        }
      }
    };
    tryFetch();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [project, path, version]);

  useEffect(() => {
    if (!section || content == null || !containerRef.current) return;
    const headings = containerRef.current.querySelectorAll("h1, h2, h3, h4");
    for (const h of Array.from(headings)) {
      if ((h.textContent ?? "").includes(section)) {
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
    }
  }, [section, content]);

  // ── Review-mode branch ──────────────────────────────────
  if (
    activeReview &&
    activeReview.filePath === path &&
    content !== null &&
    content !== ""
  ) {
    const session = sessions.get(activeReview.sid);
    if (session) {
      const grouped = selectProposeChangesByFile(session);
      const hunks = grouped.get(path) ?? [];
      const handleResolve = (rid: string, resp: ProposeChangeResponse) =>
        resolveRequest(session.bonsaiSid, rid, resp);
      const handleAcceptAll = () => {
        for (const h of hunks) {
          if (h.state === "pending") {
            resolveRequest(session.bonsaiSid, h.requestId, {
              behavior: "allow",
              applied: "original",
            });
          }
        }
      };
      const handleRejectAll = () => {
        for (const h of hunks) {
          if (h.state === "pending") {
            resolveRequest(session.bonsaiSid, h.requestId, {
              behavior: "deny",
              discuss: false,
            });
          }
        }
      };
      const handleDiscuss = (text: string) => {
        for (const h of hunks) {
          if (h.state === "pending") {
            resolveRequest(session.bonsaiSid, h.requestId, {
              behavior: "deny",
              discuss: true,
              feedback: text,
            });
          }
        }
      };
      return (
        <ReviewPanel
          filePath={path}
          content={content}
          hunks={hunks}
          onResolve={handleResolve}
          onAcceptAll={handleAcceptAll}
          onRejectAll={handleRejectAll}
          onDiscuss={handleDiscuss}
          onExit={() => setActiveReview(null)}
        />
      );
    }
  }

  // ── Default file-viewer branch ─────────────────────────
  if (content == null) {
    return (
      <div className="cp-preview-loading">
        {waiting ? `Waiting for agent to create ${path}…` : `Loading ${path}…`}
      </div>
    );
  }
  if (content === "") {
    return <div className="cp-preview-loading">Could not load {path}</div>;
  }
  return (
    <div ref={containerRef} className="cp-preview-content">
      <div className="cp-preview-path">{path}</div>
      <MarkdownPreview content={content} />
    </div>
  );
}
