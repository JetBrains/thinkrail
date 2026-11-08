import { RiFullscreenLine as Maximize2 } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { fontsLoaded, resolveFont, watchFont } from "@thinkrail/ui/fonts";
import { onThemeSwap } from "@thinkrail/ui/theme";
import { type ReactNode, useEffect, useState } from "react";
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
	const t = useT();
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let generation = 0;
		const run = () => {
			generation = generation + 1;
			const current = generation;
			const stale = () => cancelled || current !== generation;
			fontsLoaded(resolveFont("tr-code-block"))
				.then(() => (stale() ? null : renderMermaid(source)))
				.then((res) => {
					if (res === null || stale()) return;
					if (res.svg !== undefined) {
						setSvg(res.svg);
						setError(null);
					} else {
						setError(res.error ?? "");
					}
				});
		};
		setSvg(null);
		setError(null);
		run();
		const stopThemeWatch = onThemeSwap(run);
		const stopFontsWatch = watchFont("tr-code-block", ["family"], run);
		return () => {
			cancelled = true;
			stopThemeWatch();
			stopFontsWatch();
		};
	}, [source]);

	if (error !== null) {
		return (
			<div data-testid="mermaid-error" className="flex flex-col gap-4">
				<span className="text-feedback-error tr-text-metadata">
					{t("visualize.mermaid.renderFailed", {
						error: error || t("visualize.mermaid.renderFailedFallback"),
					})}
				</span>
				<pre className="overflow-auto rounded-sm bg-container-header-bg p-8 tr-code-text text-text-default">
					{source}
				</pre>
			</div>
		);
	}
	if (svg === null) {
		return (
			fallback ?? (
				<span className="text-text-muted tr-text-metadata">{t("visualize.mermaid.rendering")}</span>
			)
		);
	}
	return (
		<div className="relative">
			<div
				data-testid="mermaid-svg"
				className="overflow-auto [&_svg]:h-auto [&_svg]:max-w-full"
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
			<IconButton
				icon={Maximize2}
				label={t("visualize.mermaid.fullScreenLabel")}
				tooltip={t("visualize.mermaid.fullScreen")}
				variant="outline"
				data-testid="mermaid-fullscreen"
				onClick={() => setOpen(true)}
				className="absolute top-4 right-4"
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					data-testid="mermaid-fullscreen-dialog"
					className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-8"
				>
					<DialogHeader>
						<DialogTitle>{title || t("visualize.mermaid.dialogTitle")}</DialogTitle>
					</DialogHeader>
					<PanZoomView svg={svg} />
				</DialogContent>
			</Dialog>
		</div>
	);
}
