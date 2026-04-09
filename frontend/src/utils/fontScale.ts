/**
 * Settings-driven font scale system.
 *
 * All font sizes, spacing, and radii derive from --font-base via CSS calc() ratios.
 * This module provides:
 * - applyFontScale() — sets CSS custom properties on :root from settings
 * - computeFontSize() — computes a px value for Monaco editors (which need JS values)
 * - useFontSize() — React hook wrapping computeFontSize with settings + view mode
 */

import { useSettingsStore } from "@/store/settingsStore.ts";

export const FONT_RATIOS: Record<string, number> = {
  xs: 0.69,
  sm: 0.77,
  md: 0.85,
  lg: 0.92,
  body: 1.0,
  lg2: 1.15,
  xl: 1.31,
};

/** Compute a rounded px value for a given base and scale step. */
export function computeFontSize(base: number, step: string): number {
  return Math.round(base * (FONT_RATIOS[step] ?? 1));
}

/** Compute all font sizes for a given base. */
export function computeAllFontSizes(base: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [step, ratio] of Object.entries(FONT_RATIOS)) {
    result[step] = Math.round(base * ratio);
  }
  return result;
}

/**
 * Apply font-base and compact-font-base CSS custom properties on :root.
 * Called once on settings load and whenever settings change.
 * All calc()-based tokens in tokens.css recalculate automatically.
 */
export function applyFontScale(base: number, compactBase: number): void {
  const root = document.documentElement.style;
  root.setProperty("--font-base", base + "px");
  root.setProperty("--compact-font-base", compactBase + "px");
}

/**
 * React hook: returns a computed px font size from settings.
 * Use this for Monaco editor fontSize props.
 *
 * By default uses `font_size` (normal base). Pass `compact: true` for editors
 * rendered inside the compact chat stream (DiffCard, PromptPreview) so they
 * use `compact_font_size` instead.
 *
 * @param step - scale step name (xs, sm, md, lg, body, lg2, xl)
 * @param compact - if true, use compact_font_size as base
 */
export function useFontSize(step: string = "body", compact?: boolean): number {
  const settings = useSettingsStore((s) => s.settings);
  const base = compact
    ? (settings?.compact_font_size ?? 9)
    : (settings?.font_size ?? 13);
  return computeFontSize(base, step);
}
