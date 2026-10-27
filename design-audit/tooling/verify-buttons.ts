// Loads design-audit/buttons.html in every bundled theme and checks the button contract from the
// page's own measurements: geometry per size, focus outline visibility, label contrast per state,
// and geometry stability across states. Usage: node (22+) via `bun design-audit/tooling/verify-buttons.ts`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = pathToFileURL(join(ROOT, "buttons.html")).href;
const OUT = join(ROOT, "data", "verification", "buttons");
const THEMES = [
	"dark",
	"light",
	"minimal-dark",
	"minimal-light",
	"high-contrast-dark",
	"high-contrast-light",
];
const GEOMETRY: Record<string, { h: number; px: number; icon: number; gap: number }> = {
	s: { h: 20, px: 4, icon: 14, gap: 4 },
	m: { h: 24, px: 8, icon: 16, gap: 4 },
	l: { h: 32, px: 12, icon: 20, gap: 6 },
};

interface M {
	height: number;
	width: number;
	paddingX: string;
	gap: string;
	icon: string;
	text: number | null;
	focus: number | null;
	outline: string;
	theme: string;
	size: string;
	expect?: string;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const problems: string[] = [];
const summary: Record<string, unknown> = {};
for (const theme of THEMES) {
	const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	await page.goto(`${HTML}?theme=${theme}`);
	await page.waitForFunction(() => {
		const r = (window as unknown as { __BTN_REPORT__?: Record<string, unknown> }).__BTN_REPORT__;
		const n = document.querySelectorAll("[data-bk-spec]").length;
		return !!r && n > 0 && Object.keys(r).length >= n;
	});
	const report = (await page.evaluate(
		() => (window as unknown as { __BTN_REPORT__: Record<string, M> }).__BTN_REPORT__,
	)) as Record<string, M>;
	const applied = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
	if (applied && applied !== theme) problems.push(`${theme}: page applied ${applied}`);
	for (const e of errors) problems.push(`${theme}: page error ${e}`);
	const minText: Record<string, number> = {};
	let minFocus = Infinity;
	for (const [id, m] of Object.entries(report)) {
		const g = GEOMETRY[m.size];
		if (!g) continue;
		const [kind, variant, , state] = id.split(":");
		if (m.height !== g.h) problems.push(`${theme} ${id}: height ${m.height} ≠ ${g.h}`);
		if (m.expect === "icon" && m.width !== g.h)
			problems.push(`${theme} ${id}: width ${m.width} ≠ ${g.h}`);
		if (m.expect === "text" && m.paddingX !== `${g.px}px ${g.px}px`)
			problems.push(`${theme} ${id}: padding ${m.paddingX}`);
		if (m.icon !== "—" && m.icon !== `${g.icon}px`) problems.push(`${theme} ${id}: icon ${m.icon}`);
		if (kind === "state" && state === "focus-visible") {
			if (m.focus === null) problems.push(`${theme} ${id}: no focus outline`);
			else {
				minFocus = Math.min(minFocus, m.focus);
				if (m.focus < 3) problems.push(`${theme} ${id}: focus contrast ${m.focus}`);
			}
		}
		if (kind === "state" && m.text !== null && state !== "loading-icon") {
			const key = `${variant}:${state}`;
			minText[key] = Math.min(minText[key] ?? Infinity, m.text);
			const floor = state === "disabled" ? 1.5 : 4.5;
			if (m.text < floor) problems.push(`${theme} ${id}: label contrast ${m.text} < ${floor}`);
		}
	}
	// geometry must not move between states of one variant × size
	const widths = new Map<string, Set<number>>();
	for (const [id, m] of Object.entries(report)) {
		const [kind, variant, size, state] = id.split(":");
		if (kind !== "state" || state?.startsWith("loading")) continue;
		const key = `${variant}:${size}`;
		widths.set(key, (widths.get(key) ?? new Set()).add(m.width));
	}
	for (const [key, set] of widths)
		if (set.size > 1)
			problems.push(`${theme} ${key}: width changes across states ${[...set].join("/")}`);
	summary[theme] = {
		specimens: Object.keys(report).length,
		matrix: Object.keys(report).filter((k) => k.startsWith("matrix:")).length,
		minFocus,
		minText,
	};
	await page.screenshot({ path: join(OUT, `${theme}.png`), fullPage: true });
	await page.close();
}
await browser.close();
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify({ summary, problems }, null, "\t")}\n`);
console.log(JSON.stringify(summary, null, 1));
console.log(problems.length ? problems.join("\n") : "no problems");
process.exit(problems.length ? 1 : 0);
