import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { Button, IconButton } from "@thinkrail/extension-sdk/ui/button";
import { cn } from "@thinkrail/extension-sdk/ui/utils";
import { resultText, strArg, type ToolRenderProps } from "@thinkrail/extension-sdk/web";
import { useEffect, useState } from "react";
import { type CardSwatch, cssVariables, paletteFromResult } from "./details";

function useCopy(text: string) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	};
	return { copied, copy };
}

function SwatchTile({ swatch }: { swatch: CardSwatch }) {
	const { copied, copy } = useCopy(swatch.hex);
	const sample = swatch.contrast?.text === "black" ? "#000000" : "#ffffff";
	return (
		<div
			data-testid="palette-swatch"
			className="palette:flex palette:min-w-0 palette:flex-col palette:gap-4"
		>
			<svg
				viewBox="0 0 80 48"
				role="img"
				aria-label={`${swatch.hex} ${swatch.role}`}
				className="palette:h-48 palette:w-full"
			>
				<rect width="80" height="48" rx="4" fill={swatch.hex} />
				{swatch.contrast ? (
					<text x="40" y="30" textAnchor="middle" fontSize="14" fill={sample}>
						Aa
					</text>
				) : null}
			</svg>
			<div className="palette:flex palette:items-center palette:justify-between palette:gap-2">
				<span className="tr-code-text-small palette:truncate palette:text-text-default">
					{swatch.hex}
				</span>
				<IconButton
					icon={copied ? RiCheckLine : RiFileCopyLine}
					label={copied ? `Copied ${swatch.hex}` : `Copy ${swatch.hex}`}
					size="s"
					onClick={() => void copy()}
				/>
			</div>
			<span className="tr-text-metadata palette:truncate palette:text-text-muted">
				{swatch.role}
			</span>
			{swatch.contrast ? (
				<span
					data-rating={swatch.contrast.rating}
					className={cn(
						"tr-text-metadata",
						swatch.contrast.rating === "fail"
							? "palette:text-feedback-error"
							: "palette:text-text-muted",
					)}
				>
					{`${swatch.contrast.ratio}:1 ${swatch.contrast.rating}`}
				</span>
			) : null}
		</div>
	);
}

export function PaletteCard({ args, result, status }: ToolRenderProps) {
	const palette = paletteFromResult(result);
	const variables = palette ? cssVariables(palette) : "";
	const { copied, copy } = useCopy(variables);
	if (!palette) {
		return (
			<p className="tr-text-metadata palette:text-text-muted">
				{status === "error"
					? resultText(result)
					: `Mixing a palette from ${strArg(args, "base") || "a base colour"}…`}
			</p>
		);
	}
	return (
		<div data-testid="palette-card" className="palette:flex palette:flex-col palette:gap-8">
			<div className="palette:grid palette:grid-cols-5 palette:gap-8">
				{palette.colors.map((swatch, index) => (
					<SwatchTile key={`${index}-${swatch.hex}`} swatch={swatch} />
				))}
			</div>
			<div className="palette:flex palette:items-center palette:justify-between palette:gap-8">
				<span className="tr-text-metadata palette:text-text-muted">
					{`${palette.harmony} · ${palette.base}`}
				</span>
				<Button
					variant="outline"
					size="s"
					iconLeft={copied ? RiCheckLine : RiFileCopyLine}
					onClick={() => void copy()}
				>
					{copied ? "Copied" : "Copy CSS variables"}
				</Button>
			</div>
		</div>
	);
}
