import { LOCALE_PREFERENCE_KEY, type MenuLocale, normalizeMenuLocale } from "./menuLocale";

export interface DesktopLocaleSwitchDependencies {
	/** Persist one preference in the window's scope. Returns whether the write landed. */
	writePreference(key: string, value: string): boolean;
	/** Rebuild the native application menu in `locale`. */
	installMenu(locale: MenuLocale): boolean;
}

export interface DesktopLocaleSwitch {
	/** The locale the menu and the failure dialogs are currently in. */
	readonly locale: MenuLocale;
	/**
	 * Switch the desktop process to `locale`: persist it, then rebuild the menu.
	 *
	 * A locale the build does not speak is refused before anything is written, so a stale or hostile
	 * value cannot leave a preference the next launch would fail to honour. The menu is rebuilt only
	 * after the preference is stored, because a menu the next launch disagrees with is worse than one
	 * that spends a single session in the old language.
	 */
	apply(locale: unknown): MenuLocale | null;
	/**
	 * Rebuild the menu after a write that came in through the general preference channel, which
	 * already persisted the value.
	 */
	follow(locale: unknown): MenuLocale | null;
}

/**
 * The desktop half of a locale switch.
 *
 * The client persists the choice too, but it cannot rebuild a menu it does not own: the menu is built
 * in this process from the same `thinkrail-locale` preference. Tracking the value here keeps the menu,
 * the restart dialogs and the next launch reading one source.
 */
export function createDesktopLocaleSwitch(
	initial: MenuLocale,
	dependencies: DesktopLocaleSwitchDependencies,
): DesktopLocaleSwitch {
	let current = initial;
	const install = (locale: MenuLocale): MenuLocale => {
		current = locale;
		dependencies.installMenu(locale);
		return locale;
	};
	return {
		get locale() {
			return current;
		},
		apply(locale: unknown): MenuLocale | null {
			const next = normalizeMenuLocale(typeof locale === "string" ? locale : null);
			if (!next) return null;
			if (!dependencies.writePreference(LOCALE_PREFERENCE_KEY, next)) return null;
			return install(next);
		},
		follow(locale: unknown): MenuLocale | null {
			const next = normalizeMenuLocale(typeof locale === "string" ? locale : null);
			return next ? install(next) : null;
		},
	};
}
