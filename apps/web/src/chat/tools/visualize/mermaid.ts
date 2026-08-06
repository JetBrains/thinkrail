// Lazy mermaid loader + render. The dynamic `import("mermaid")` keeps mermaid (a heavy dep) out of the
// eager bundle, per the chat/tools code-splitting convention. Diagrams are themed from our CSS tokens so
// they match the active `[data-theme]` (the same getComputedStyle approach Monaco/xterm use).

type Mermaid = typeof import("mermaid")["default"];

let mermaidPromise: Promise<Mermaid> | null = null;
let idCounter = 0;

async function loadMermaid(): Promise<Mermaid> {
	if (!mermaidPromise) mermaidPromise = import("mermaid").then((m) => m.default);
	return mermaidPromise;
}

function cssVar(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Map our design tokens onto mermaid's base-theme variables so diagrams match the active theme. */
function themeVariables(): Record<string, string> {
	const text = cssVar("--text-default");
	const border = cssVar("--border-default");
	const elevated = cssVar("--container-elevated-bg");
	const bg = cssVar("--container-workspace-bg");
	return {
		background: bg,
		mainBkg: elevated,
		primaryColor: elevated,
		primaryTextColor: text,
		primaryBorderColor: border,
		secondaryColor: cssVar("--control-bg-selected") || elevated,
		tertiaryColor: cssVar("--container-content-bg") || bg,
		lineColor: cssVar("--text-muted") || border,
		textColor: text,
		nodeBorder: border,
		clusterBkg: bg,
		clusterBorder: border,
		titleColor: text,
		fontFamily: cssVar("--tr-font-family-code") || "monospace",
	};
}

export interface MermaidRenderResult {
	svg?: string;
	error?: string;
}

/** Render mermaid `source` to a themed SVG string. Returns an error message instead of throwing. */
export async function renderMermaid(source: string): Promise<MermaidRenderResult> {
	const id = `tr-mermaid-${idCounter++}`;
	try {
		const mermaid = await loadMermaid();
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: "base",
			themeVariables: themeVariables(),
		});
		const { svg } = await mermaid.render(id, source);
		return { svg };
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	} finally {
		// mermaid can leave a temp measurement node behind on parse errors; clean it up.
		document.getElementById(id)?.remove();
		document.querySelector(`#d${id}`)?.remove();
	}
}
