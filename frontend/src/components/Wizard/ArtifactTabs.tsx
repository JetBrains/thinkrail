interface ArtifactTab {
  path: string;
}

interface ArtifactTabsProps<T extends ArtifactTab> {
  artifacts: readonly T[];
  activePath: string;
  onSelect: (path: string) => void;
}

/**
 * Pure tab-strip UI used by the wizard done-screen when more than one
 * artifact is openable. Renders a button per artifact; the active one
 * is underlined in green (style is defined in ``WizardDonePanel.css``).
 *
 * Caller owns selection state — this component only renders and emits
 * ``onSelect`` clicks.
 */
export function ArtifactTabs<T extends ArtifactTab>({
  artifacts,
  activePath,
  onSelect,
}: ArtifactTabsProps<T>) {
  return (
    <div className="wiz-done-doc-tabs" role="tablist">
      {artifacts.map((artifact) => {
        const isActive = artifact.path === activePath;
        return (
          <button
            key={artifact.path}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`wiz-done-doc-tab${isActive ? " wiz-done-doc-tab--active" : ""}`}
            onClick={() => onSelect(artifact.path)}
          >
            {artifact.path.replace(/^\.tr\//, "")}
          </button>
        );
      })}
    </div>
  );
}
