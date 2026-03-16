/**
 * Shared mermaid initialization — single source of truth for theme config.
 * Used by both MarkdownPreview (code fences) and VisualizationCard (diagrams).
 */
import mermaid from "mermaid";

let initialized = false;

export function ensureMermaid(): void {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      primaryColor: "#393b40",
      primaryTextColor: "#dfe1e5",
      primaryBorderColor: "#43454a",
      lineColor: "#6f737a",
      secondaryColor: "#2b2d30",
      tertiaryColor: "#1e1f22",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "16px",
    },
  });
  initialized = true;
}

export { mermaid };
