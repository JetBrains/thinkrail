import { onThemeSwap } from "@thinkrail/ui/theme";
import { useEffect, useState } from "react";
import type { SvgThemeTokens } from "./svgDocument";

function token(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readTokens(diff: boolean): SvgThemeTokens {
	return {
		background: diff ? token("--container-content-bg") : token("--container-workspace-bg"),
		foreground: token("--text-default"),
	};
}

export function useSvgTheme(diff: boolean): SvgThemeTokens | null {
	const [tokens, setTokens] = useState<SvgThemeTokens | null>(null);
	useEffect(() => {
		const refresh = () => setTokens(readTokens(diff));
		refresh();
		return onThemeSwap(refresh);
	}, [diff]);
	return tokens;
}
