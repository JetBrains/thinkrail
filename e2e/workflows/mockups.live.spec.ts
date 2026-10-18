import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { checks, defineScenario, endAllSessions, signals, workflowTest } from "./harness";
import { mockupChecks, mockupJudgeContext, mockupSignals } from "./mockupQuality";

test.afterAll(() => endAllSessions());

const BRAND = "#0f766e";

function seedLandingPage(cwd: string): void {
	writeFileSync(
		join(cwd, "AGENTS.md"),
		[
			"# leafline",
			"",
			"leafline is a static marketing site for a plant-care app: `index.html` + `styles.css`, no build step.",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(cwd, "styles.css"),
		[
			":root {",
			`  --brand: ${BRAND};`,
			"  --ink: #1c1917;",
			"  --paper: #fafaf9;",
			"  --radius: 10px;",
			"  font-family: 'Inter', system-ui, sans-serif;",
			"}",
			"body { margin: 0; background: var(--paper); color: var(--ink); }",
			".site-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 32px; border-bottom: 1px solid #e7e5e4; }",
			".logo { font-weight: 700; color: var(--brand); }",
			".nav a { margin-left: 24px; color: var(--ink); text-decoration: none; }",
			".cta { background: var(--brand); color: white; border: 0; border-radius: var(--radius); padding: 10px 18px; }",
			".hero { padding: 96px 32px; text-align: center; }",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(cwd, "index.html"),
		[
			"<!doctype html>",
			'<html lang="en">',
			'<head><meta charset="utf-8"><title>leafline</title><link rel="stylesheet" href="styles.css"></head>',
			"<body>",
			'  <header class="site-header">',
			'    <span class="logo">leafline</span>',
			'    <nav class="nav"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav>',
			'    <button class="cta">Get the app</button>',
			"  </header>",
			'  <main class="hero">',
			"    <h1>Never forget to water again</h1>",
			"    <p>leafline reminds you when each plant is thirsty.</p>",
			"  </main>",
			"</body>",
			"</html>",
			"",
		].join("\n"),
	);
}

const NO_SOURCE_EDITS = [
	signals.toolCall("edit", { pathEndsWith: "index.html" }),
	signals.toolCall("write", { pathEndsWith: "index.html" }),
	signals.toolCall("edit", { pathEndsWith: "styles.css" }),
	signals.toolCall("write", { pathEndsWith: "styles.css" }),
];

const QUALITY = [mockupChecks.valid()];
const ADVISORY = [mockupChecks.wellFormed()];

workflowTest(
	defineScenario({
		name: "mockups: brainstorming a UI change shows a mockup before any source edit",
		skill: "brainstorming",
		workspace: seedLandingPage,
		user: {
			brief:
				"You own the leafline landing page and want a search box in the site header so visitors can " +
				"find plant-care guides. You care how it looks next to the existing nav and button. Answer " +
				"questions briefly; don't ask for a mockup yourself, and don't approve implementation yet.",
			opening:
				"I'd like to add a search box to the header of our landing page. Let's work out what it should be.",
			maxUserTurns: 2,
		},
		dialog: { fallback: "pickRecommended" },
		stopWhen: [mockupSignals.shown()],
		forbid: NO_SOURCE_EDITS,
		watchdog: { budget: { maxTurns: 10 } },
		expect: [checks.expectSkillRead("brainstorming"), mockupChecks.shown(), ...QUALITY],
		advisory: [...ADVISORY, mockupChecks.reuses("brand color", /#0f766e|var\(--brand\)/i)],
		judge: {
			rubric: [
				"The agent showed the proposed header as a rendered mockup instead of only describing it in prose.",
				"The mockup depicts a header with the existing logo, nav links and button plus a new search box.",
				"The agent did not edit index.html or styles.css before the design was agreed.",
			],
			context: mockupJudgeContext,
		},
	}),
);

workflowTest(
	defineScenario({
		name: "mockups: restyling an existing screen shows a before/after pair",
		skill: "brainstorming",
		workspace: seedLandingPage,
		entry: {
			prompt:
				"Before changing anything: show me what the landing page hero would look like as a two-column " +
				"layout (text on the left, an illustration placeholder on the right) compared with how it " +
				"looks today. Don't edit any files yet.",
		},
		dialog: { fallback: "pickRecommended" },
		stopWhen: [
			signals.toolCall("visualize", {
				where: (call) => call.result !== undefined && call.args.type === "mockup" && !call.isError,
			}),
		],
		forbid: NO_SOURCE_EDITS,
		watchdog: { budget: { maxTurns: 6 } },
		expect: [mockupChecks.pairShown(), ...QUALITY],
		advisory: [
			...ADVISORY,
			mockupChecks.reuses("brand color", /#0f766e|var\(--brand\)/i),
			mockupChecks.reuses("hero copy", /Never forget to water again/i),
		],
		judge: {
			rubric: [
				"The 'before' mockup matches the current single-column centered hero.",
				"The 'after' mockup shows a two-column hero with text left and an illustration placeholder right.",
				"Both mockups keep the project's look (brand teal, Inter/system font, light paper background).",
			],
			context: mockupJudgeContext,
		},
	}),
);

workflowTest(
	defineScenario({
		name: "mockups: asking for header options shows alternatives with per-option mockups",
		skill: "brainstorming",
		workspace: seedLandingPage,
		entry: {
			prompt:
				"Give me two or three different layout options for the landing page header on phones and let " +
				"me pick one. Don't change any files.",
		},
		dialog: { fallback: "pickRecommended" },
		stopWhen: [
			signals.toolCall("visualize", {
				where: (call) =>
					call.result !== undefined && call.args.type === "comparison" && !call.isError,
			}),
			signals.toolCall("ask_user_question", {
				where: (call) => JSON.stringify(call.args).includes("mockup"),
			}),
		],
		forbid: NO_SOURCE_EDITS,
		watchdog: { budget: { maxTurns: 6 } },
		expect: [mockupChecks.optionsShown(2), ...QUALITY],
		advisory: [...ADVISORY],
		judge: {
			rubric: [
				"Each alternative is a distinct phone-width header layout, not the same layout restyled.",
				"Each alternative is rendered as a mockup the user can compare, with its trade-off stated.",
			],
			context: mockupJudgeContext,
		},
	}),
);
