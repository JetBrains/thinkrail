import { useMemo } from "react";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { useActiveSession } from "../useActiveSession.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { StatusBadge, fileMatchesCovers } from "../utils.tsx";
import type { RegistryEntry } from "@/types/spec.ts";
import "./RelatedSpecs.css";

export function RelatedSpecs() {
  const session = useActiveSession();
  const specs = useSpecStore((s) => s.specs);
  const selectSpec = useSpecStore((s) => s.selectSpec);

  const { sessionSpecs, coveringSpecs } = useMemo(() => {
    if (!session) return { sessionSpecs: [] as RegistryEntry[], coveringSpecs: [] as RegistryEntry[] };

    const specIds = new Set(session.specIds);
    const specMap = new Map(specs.map((s) => [s.id, s]));

    const sessionSpecs = session.specIds
      .map((id) => specMap.get(id))
      .filter((s): s is RegistryEntry => !!s);

    const changedFiles = Object.keys(session.metrics.filesChanged);
    const coveringSpecs = changedFiles.length > 0
      ? specs.filter((s) =>
          !specIds.has(s.id) &&
          s.covers.length > 0 &&
          changedFiles.some((file) => fileMatchesCovers(file, s.covers))
        )
        .sort((a, b) => a.title.localeCompare(b.title))
      : [];

    return { sessionSpecs, coveringSpecs };
  }, [session, specs]);

  const totalCount = sessionSpecs.length + coveringSpecs.length;

  return (
    <CollapsibleSection title="Related Specs" count={totalCount || undefined}>
      {totalCount === 0 ? (
        <div className="section-placeholder">No related specs found</div>
      ) : (
        <div className="related-specs">
          {sessionSpecs.length > 0 && (
            <div className="related-specs__group">
              <div className="related-specs__label">Session Specs ({sessionSpecs.length})</div>
              {sessionSpecs.map((spec) => (
                <button
                  key={spec.id}
                  className="related-specs__item"
                  onClick={() => selectSpec(spec.id)}
                >
                  <StatusBadge status={spec.status} />
                  <span>{spec.title}</span>
                </button>
              ))}
            </div>
          )}
          {coveringSpecs.length > 0 && (
            <div className="related-specs__group">
              <div className="related-specs__label">Covering Specs ({coveringSpecs.length})</div>
              {coveringSpecs.map((spec) => (
                <button
                  key={spec.id}
                  className="related-specs__item"
                  onClick={() => selectSpec(spec.id)}
                >
                  <StatusBadge status={spec.status} />
                  <span>{spec.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}
