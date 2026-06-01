import { useEffect, useState } from "react";
import { readFile } from "@/services/files";
import { artifactPathCandidates } from "./registry";

interface ArtifactRef {
  path: string;
}

/**
 * Load the markdown body of each artifact in parallel. Tries the
 * usual ``GOAL&REQUIREMENTS.md`` / ``.bonsai/GOAL&REQUIREMENTS.md``
 * fallbacks (see ``artifactPathCandidates``). Returns a map keyed by
 * artifact path; missing entries stay ``undefined`` until the fetch
 * resolves so callers can render a loading state.
 */
export function useArtifactContents(
  projectPath: string | null,
  artifacts: readonly ArtifactRef[],
): Record<string, string> {
  const [contents, setContents] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!projectPath || artifacts.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        artifacts.map(async (artifact) => {
          for (const candidate of artifactPathCandidates(artifact.path)) {
            try {
              const data = await readFile(projectPath, candidate);
              if (data?.content != null) return [artifact.path, data.content] as const;
            } catch {
              // try next candidate
            }
          }
          return [artifact.path, ""] as const;
        }),
      );
      if (!cancelled) setContents(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, artifacts]);

  return contents;
}
