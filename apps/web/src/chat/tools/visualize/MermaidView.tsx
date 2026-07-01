import { Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CodeBlock } from "../CodeBlock";
import { renderMermaid } from "./mermaid";
import { PanZoomView } from "./PanZoomView";

/**
 * Render mermaid `source` to a themed SVG, re-rendering on `[data-theme]` changes. On a parse/render
 * error, falls back to showing the raw source (still copy-pasteable) — mermaid *syntax* is the model's
 * concern, so we surface it rather than swallow it. A "full screen" button opens the diagram large in a
 * `Dialog` (which brings its own close button + Esc / overlay dismissal).
 */
export function MermaidView({ source, title }: { source: string; title?: string }) {
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const run = () => {
			renderMermaid(source).then((res) => {
				if (cancelled) return;
				if (res.svg !== undefined) {
					setSvg(res.svg);
					setError(null);
				} else {
					setError(res.error ?? "Failed to render diagram");
				}
			});
		};
		setSvg(null);
		setError(null);
		run();
		// Re-render when the theme flips so token-derived colors stay in sync.
		const observer = new MutationObserver(run);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [source]);

	if (error !== null) {
		return (
			<div data-testid="mermaid-error" className="flex flex-col gap-xs">
				<span className="text-red text-xs">Diagram failed to render: {error}</span>
				<CodeBlock code={source} lang="" />
			</div>
		);
	}
	if (svg === null) {
		return <span className="text-muted text-xs">Rendering diagram…</span>;
	}
	return (
		<div className="relative">
			<div
				data-testid="mermaid-svg"
				className="overflow-auto [&_svg]:h-auto [&_svg]:max-w-full"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid renders agent-provided source with securityLevel "strict"
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
			<button
				type="button"
				data-testid="mermaid-fullscreen"
				aria-label="View diagram full screen"
				title="Full screen"
				onClick={() => setOpen(true)}
				className="absolute top-xs right-xs rounded-[var(--radius-sm)] border border-border2 bg-elevated p-1 text-muted transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
			>
				<Maximize2 className="size-3.5" />
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					data-testid="mermaid-fullscreen-dialog"
					className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-sm"
				>
					<DialogHeader>
						<DialogTitle>{title || "Diagram"}</DialogTitle>
					</DialogHeader>
					<PanZoomView svg={svg} />
				</DialogContent>
			</Dialog>
		</div>
	);
}
