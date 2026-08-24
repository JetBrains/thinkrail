export const THEME_STORAGE_KEY = "thinkrail-site-theme";

export type SiteTheme = "dark" | "light";

export function normalizeTheme(raw: string | null): SiteTheme | null {
	if (raw === null) return null;
	return raw === "light" ? "light" : "dark";
}

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

		const nextTheme = theme === "dark" ? "light" : "dark";
		themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);

		const chrome = getComputedStyle(document.documentElement).getPropertyValue("--chrome").trim();
		if (chrome) {
			document
				.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
				?.setAttribute("content", chrome);
		}

		if (save) {
			try {
				localStorage.setItem(THEME_STORAGE_KEY, theme);
			} catch {}
		}
	};

	apply(getSavedTheme() ?? getSystemTheme(), false);

	themeToggle.addEventListener("click", () => {
		const current = document.documentElement.getAttribute("data-theme") ?? "dark";
		apply(current === "dark" ? "light" : "dark", true);
	});

	mediaQuery.addEventListener("change", () => {
		if (!getSavedTheme()) {
			apply(getSystemTheme(), false);
		}
	});
}
