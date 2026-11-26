import { onFontsChange, resolveFont } from "@thinkrail/ui/fonts";
import { onThemeSwap } from "@thinkrail/ui/theme";
import { useEffect, useState } from "react";
import { type Palette, resolvePalette } from "./palette";

export interface CanvasLook {
	palette: Palette | null;
	font: string;
}

/** The theme's canvas colours and caption font, re-read on a theme swap or font change. */
export function useCanvasLook(root: HTMLElement | null): CanvasLook {
	const [look, setLook] = useState<CanvasLook>({ palette: null, font: "" });
	useEffect(() => {
		if (!root) return;
		const read = () => {
			const font = resolveFont("tr-text-caption");
			setLook({
				palette: resolvePalette(root),
				font: `${font.weight} ${font.size}px ${font.family}`,
			});
		};
		read();
		const stopTheme = onThemeSwap(read);
		const stopFonts = onFontsChange(read);
		return () => {
			stopTheme();
			stopFonts();
		};
	}, [root]);
	return look;
}
