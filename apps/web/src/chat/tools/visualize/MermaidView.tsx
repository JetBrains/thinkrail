import { Maximize2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { onThemeSwap } from "@/themes";
import { CodeBlock } from "../CodeBlock";
import { renderMermaid } from "./mermaid";
import { PanZoomView } from "./PanZoomView";

export function MermaidView({
	source,
	title,
	fallback,
}: {
	source: string;
	title?: string;
	fallback?: ReactNode;
}) {
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
		const stopThemeWatch = onThemeSwap(run);
		return () => {
			cancelled = true;
			stopThemeWatch();
		};
	}, [source]);

	if (error !== null) {
		return (
			<div data-testid="mermaid-error" className="flex flex-col gap-4">
				<span className="text-feedback-error tr-text-metadata">
					Diagram failed to render: {error}
				</span>
				<CodeBlock code={source} lang="" />
			</div>
		);
	}
	if (svg === null) {
		return fallback ?? <span className="text-text-muted tr-text-metadata">Rendering diagram…</span>;
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
				className="absolute top-4 right-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-4 text-text-muted transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				<Maximize2 className="size-14" />
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					data-testid="mermaid-fullscreen-dialog"
					className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-8"
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
