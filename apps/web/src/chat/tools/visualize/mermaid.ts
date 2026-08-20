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
		document.getElementById(id)?.remove();
		document.querySelector(`#d${id}`)?.remove();
	}
}
