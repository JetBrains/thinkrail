import { THEME_FILE_NAME } from "./themeFile";

const THEME_CHANGE_EVENT = "thinkrail:themechange";

export function mockupGuideline(scratchDir: string): string {
	return [
		`write a self-contained HTML file under \`${scratchDir}\` that links \`<link rel="stylesheet" href="${THEME_FILE_NAME}">\``,
		`(it is in that directory; read it for the token names; link it, do not copy it in) and colours everything with its \`var(--…)\` tokens instead of fixed colours, leaving the page background to the theme.`,
		"Scripts and https CDN libraries (d3, Chart.js…) run; fetch and XHR are blocked, so inline the data.",
		`A script that reads token colours (canvas charts, \`getComputedStyle\`) should redraw on the window's \`${THEME_CHANGE_EVENT}\` event.`,
		"Let the content set the height: no `vh` units or `height: 100%` on html/body.",
		"If you have a browser tool, open the file to check it,",
	].join(" ");
}
