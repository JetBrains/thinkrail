// The theme swap: sets `data-theme` on <html>, which flips the token block in `styles/tokens.css` (every
// Tailwind utility resolves to the live `var(--token)`, so nothing in components changes). The host owns
// the theme (server-synced `AppConfig`); this module only applies it + caches a first-paint hint.
import { THEME_IDS, Theme, type ThemeId } from "@thinkrail/contracts";
import { STORAGE_PREFIX } from "../constants/branding";

export const DEFAULT_THEME: ThemeId = Theme.Dark;

const LABELS: Record<ThemeId, string> = {
	[Theme.Dark]: "Dark",
	[Theme.Light]: "Light",
	[Theme.Darcula]: "Darcula",
	[Theme.Gruvbox]: "Gruvbox",
	[Theme.HighContrast]: "High Contrast",
};

/** The pickable themes, in display order — the Appearance settings section's source. */
export const THEMES: { id: ThemeId; label: string }[] = THEME_IDS.map((id) => ({
	id,
	label: LABELS[id],
}));

// A render cache only (NOT the setting store — the host is the source of truth): applied pre-React so the
// very first paint matches, before `server.welcome` arrives, avoiding a flash of the wrong theme.
const HINT_KEY = `${STORAGE_PREFIX}theme`;

function isThemeId(v: unknown): v is ThemeId {
	return typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);
}

/** Apply a theme by setting `data-theme` on <html>; `color-scheme` rides the CSS token block. */
export function applyTheme(id: ThemeId): void {
	document.documentElement.dataset.theme = id;
}

/** The cached first-paint theme (or the default when unset/invalid/localStorage is unavailable). */
export function readThemeHint(): ThemeId {
	try {
		const v = localStorage.getItem(HINT_KEY);
		return isThemeId(v) ? v : DEFAULT_THEME;
	} catch {
		return DEFAULT_THEME;
	}
}

/** Cache the applied theme for the next load's first paint. Best-effort — a storage failure is ignored. */
export function writeThemeHint(id: ThemeId): void {
	try {
		localStorage.setItem(HINT_KEY, id);
	} catch {
		return;
	}
}
