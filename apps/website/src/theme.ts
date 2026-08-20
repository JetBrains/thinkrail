// The site-wide theme model, shared by the landing page and every blog page: an explicit visitor
// choice persists in localStorage; without one the OS preference applies (and keeps applying live).
// Legacy multi-theme values (darcula/gruvbox, from the old 4-theme selector) are dark palettes —
// they normalize to "dark" since the toggle and its icon CSS only understand dark/light.
//
// The pre-paint FOUC guard in BaseHead.astro is the inline twin of this logic; a behavior change
// here must be mirrored there (it cannot import modules).

export const THEME_STORAGE_KEY = "thinkrail-site-theme";

export type SiteTheme = "dark" | "light";

export function normalizeTheme(raw: string | null): SiteTheme | null {
	if (raw === null) return null;
	return raw === "light" ? "light" : "dark";
}

/**
 * Wires the page's `#theme-toggle` button (no-op when absent): applies the initial theme, persists
 * explicit clicks, follows OS changes while no explicit choice exists, and keeps the aria-label and
 * `theme-color` meta (when present) in sync.
 */
export function initThemeToggle(): void {
	const themeToggle = document.getElementById("theme-toggle");
	if (!themeToggle) return;

	const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

	const getSavedTheme = (): SiteTheme | null => {
		try {
			return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
		} catch {
			return null;
		}
	};

	const getSystemTheme = (): SiteTheme => (mediaQuery.matches ? "light" : "dark");

	const apply = (theme: SiteTheme, save: boolean) => {
		document.documentElement.setAttribute("data-theme", theme);

		// Update aria-label to describe the action
		const nextTheme = theme === "dark" ? "light" : "dark";
		themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);

		// Update theme-color meta tag
		const chrome = getComputedStyle(document.documentElement).getPropertyValue("--chrome").trim();
		if (chrome) {
			document
				.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
				?.setAttribute("content", chrome);
		}

		// Only save if this is an explicit user choice
		if (save) {
			try {
				localStorage.setItem(THEME_STORAGE_KEY, theme);
			} catch {
				// storage unavailable (private mode)
			}
		}
	};

	// Initialize: prefer saved choice, fall back to system preference
	apply(getSavedTheme() ?? getSystemTheme(), false);

	// Toggle on click (always saves as explicit choice)
	themeToggle.addEventListener("click", () => {
		const current = document.documentElement.getAttribute("data-theme") ?? "dark";
		apply(current === "dark" ? "light" : "dark", true);
	});

	// Follow system changes only if no explicit choice saved
	mediaQuery.addEventListener("change", () => {
		if (!getSavedTheme()) {
			apply(getSystemTheme(), false);
		}
	});
}
