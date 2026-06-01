import { MarkdownPreview } from "@/components/FileViewer/MarkdownPreview";

interface ArtifactDocViewProps {
  /** Project-relative path. Rendered in the inline header pill when
   *  ``showHeader`` is true. */
  path: string;
  /** Optional human label shown next to the path pill. */
  label?: string | null;
  /** ``undefined`` = still loading; ``""`` = empty file; otherwise the
   *  markdown body to render. */
  body: string | undefined;
  /** When the parent already shows a tab strip naming this artifact,
   *  the inline header is redundant — set to false to hide it. */
  showHeader?: boolean;
}

/**
 * Pure UI for a single artifact's markdown preview. Owns nothing —
 * the parent loads the body (e.g. via ``useArtifactContents``) and
 * passes it in.
 */
export function ArtifactDocView({ path, label, body, showHeader = true }: ArtifactDocViewProps) {
  return (
    <div className="wiz-done-doc">
      {showHeader && (
        <div className="wiz-done-doc-head">
          <span className="wiz-done-doc-pill">{path.replace(/^\.bonsai\//, "")}</span>
          {label && <span className="wiz-done-doc-label">{label}</span>}
        </div>
      )}
      <div className="wiz-done-doc-body">
        {body === undefined ? (
          <p className="wiz-done-doc-loading">Loading…</p>
        ) : body === "" ? (
          <p className="wiz-done-doc-loading">No content yet.</p>
        ) : (
          <MarkdownPreview content={body} />
        )}
      </div>
    </div>
  );
}
