import {
	type ExtensionInfo,
	type ExtensionTheme,
	extThemeCssPath,
	extThemeKey,
} from "@thinkrail/contracts";
import { toast } from "../store";
import { setThemeOverlay, type ThemeOverlay, writeThemeOverlayHint } from "../themes";
import { getTransport } from "../transport";
import { type ExtState, useExtStore } from "./extStore";

export interface PlacedTheme {
	key: string;
	extension: ExtensionInfo;
	theme: ExtensionTheme;
}

export interface EffectiveTheme {
	source: "preview" | "selection";
	overlay: ThemeOverlay;
	css: string | null;
}

type ThemeInputs = Pick<ExtState, "hydration" | "extensions" | "themeSelection" | "themePreview">;

export const previewKey = (name: string) => `preview:${name}`;

export const selectThemes = (extensions: Record<string, ExtensionInfo>): PlacedTheme[] =>
	Object.values(extensions)
		.filter((extension) => extension.status !== "blocked" && extension.build !== null)
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap((extension) =>
			extension.themes.map((theme) => ({
				key: extThemeKey({ name: extension.name, id: theme.id }),
				extension,
				theme,
			})),
		);

export const findTheme = (extensions: Record<string, ExtensionInfo>, key: string | null) =>
	key === null ? undefined : selectThemes(extensions).find((placed) => placed.key === key);

const themeCss = ({ extension, theme }: PlacedTheme) =>
	theme.css && extension.build
		? extThemeCssPath({ name: extension.name, build: extension.build, themeId: theme.id })
		: null;

export const effectiveTheme = (state: ThemeInputs): EffectiveTheme | null => {
	if (state.themePreview) {
		const { name, overlay } = state.themePreview;
		return {
			source: "preview",
			overlay: { key: previewKey(name), mode: overlay.mode, tokens: overlay.tokens },
			css: null,
		};
	}
	const placed = findTheme(state.extensions, state.themeSelection);
	if (!placed) return null;
	return {
		source: "selection",
		overlay: { key: placed.key, mode: placed.theme.mode, tokens: placed.theme.tokens },
		css: themeCss(placed),
	};
};

const THEME_LINK = "data-ext-theme";

const setThemeLink = (path: string | null) => {
	const existing = document.head.querySelector<HTMLLinkElement>(`link[${THEME_LINK}]`);
	if (path === null) {
		existing?.remove();
		return;
	}
	const href = getTransport().hostUrl(path);
	if (existing?.getAttribute("href") === href) return;
	const link = existing ?? document.createElement("link");
	link.rel = "stylesheet";
	link.setAttribute(THEME_LINK, "");
	link.setAttribute("href", href);
	if (!existing) document.head.append(link);
};

let lastFailure: { key: string; errors: string[] } | null = null;

export const lastThemeFailure = () => lastFailure;

export const startThemeSync = () => {
	let attempted: string | undefined;

	const sync = (state: ExtState) => {
		if (state.hydration === "idle" && !state.themePreview) return;
		const next = effectiveTheme(state);
		const signature = JSON.stringify(next);
		if (signature === attempted) return;
		attempted = signature;
		const result = setThemeOverlay(next?.overlay ?? null);
		if (!result.ok && next) {
			lastFailure = { key: next.overlay.key, errors: result.errors };
			setThemeLink(null);
			if (next.source === "preview") {
				state.setThemePreview(null);
				return;
			}
			toast.error(`Theme ${next.overlay.key} was not applied: ${result.errors.join("; ")}`);
			state.selectTheme(null);
			return;
		}
		if (lastFailure?.key === next?.overlay.key) lastFailure = null;
		setThemeLink(next?.css ?? null);
		if (next?.source !== "preview")
			writeThemeOverlayHint({ selected: state.themeSelection, overlay: next?.overlay ?? null });
	};

	sync(useExtStore.getState());
	return useExtStore.subscribe((state, previous) => {
		if (
			state.extensions === previous.extensions &&
			state.themeSelection === previous.themeSelection &&
			state.themePreview === previous.themePreview &&
			state.hydration === previous.hydration
		)
			return;
		sync(state);
	});
};
