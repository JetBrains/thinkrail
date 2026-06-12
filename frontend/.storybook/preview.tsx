import type { Preview } from "@storybook/react-vite";
import { addons } from "storybook/preview-api";
import { GLOBALS_UPDATED, SET_GLOBALS } from "storybook/internal/core-events";
import { create } from "storybook/theming";

// Load the design system (tokens + theme layers) — but NOT the app's
// global.css, whose `body { overflow: hidden }` shell reset would break
// docs-page scrolling inside Storybook. See preview.css for details.
import "./preview.css";

// Theme toolbar — mirrors src/utils/theme.ts.
// NOTE: "light" is intentionally omitted — src/styles/theme-light.css is an
// unimplemented stub (identical dark values), so it would mislead in docs.
// Re-add it here once the real light theme lands.
const THEME_ITEMS = [
  { value: "dark", title: "Darcula" },
  { value: "high-contrast", title: "High Contrast" },
  { value: "dracula", title: "Dracula" },
  { value: "nord", title: "Nord" },
  { value: "solarized-dark", title: "Solarized Dark" },
  { value: "solarized-light", title: "Solarized Light" },
  { value: "claude-code", title: "Claude Code" },
];

const DEFAULT_THEME = "dark";

/** Apply a theme exactly like the app's applyTheme(): set data-theme on <html>. */
function applyTheme(theme?: string) {
  const t = theme || DEFAULT_THEME;
  document.documentElement.setAttribute("data-theme", t);
  document.body.style.background = "var(--bg)";
  document.body.style.color = "var(--text)";
}

// Apply on load and on every Theme-toolbar change. This listener is registered
// in BOTH the story-canvas iframe and the docs/MDX iframe, so native doc blocks
// (ColorPalette, Typeset) respond to the switcher too — not just stories.
applyTheme(DEFAULT_THEME);
const channel = addons.getChannel();
const onGlobals = ({ globals }: { globals?: { theme?: string } }) => applyTheme(globals?.theme);
channel.on(SET_GLOBALS, onGlobals);
channel.on(GLOBALS_UPDATED, onGlobals);

// Dark docs chrome (ThinkRail is dark-first) so themed content — whose --text is
// light — stays readable. Without this the white default docs background
// washes out the type samples.
const docsTheme = create({
  base: "dark",
  brandTitle: "ThinkRail Design System",
  appBg: "#0D0D0E",
  appContentBg: "#0D0D0E",
  appPreviewBg: "#0D0D0E",
  barBg: "#1A1A1C",
  textColor: "#dfe1e5",
  colorPrimary: "#8C81FF",
  colorSecondary: "#6AC8FF",
  fontBase: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontCode: '"JetBrains Mono", "Fira Code", monospace',
});

const preview: Preview = {
  // Give every component an auto-generated Docs tab (args table + the
  // description written above each story's `meta`). Opt a story out with
  // `tags: ["!autodocs"]`.
  tags: ["autodocs"],
  initialGlobals: { theme: DEFAULT_THEME },
  globalTypes: {
    theme: {
      description: "ThinkRail theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: THEME_ITEMS,
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: "padded",
    docs: { theme: docsTheme },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
