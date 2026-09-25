import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { installRepoExtension, reloadExtension, removeExtension } from "./fixtures/extensions";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";

const GROUP = "extension-tool-guard";
const EXTENSION = "tool-guard";

const decision = (
	id: string,
	agoMs: number,
	fields: { tool: string; summary: string; verdict: "block" | "allow"; rule?: [string, string] },
) => ({
	id,
	at: Date.now() - agoMs,
	sessionId: "e2e-session",
	sessionTitle: "Release prep",
	tool: fields.tool,
	summary: fields.summary,
	verdict: fields.verdict,
	...(fields.rule ? { rule: { id: fields.rule[0], label: fields.rule[1] } } : {}),
	...(fields.verdict === "block" ? { reason: "tool-guard blocked this call" } : {}),
});

const seedStore = () => {
	const dir = join(E2E_DATA_DIR, "ext-store");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${EXTENSION}.json`),
		JSON.stringify({
			log: [
				decision("d4", 20_000, {
					tool: "bash",
					summary: "git push --force origin main",
					verdict: "block",
					rule: ["git-push-force", "git push --force"],
				}),
				decision("d3", 65_000, { tool: "bash", summary: "bun test", verdict: "allow" }),
				decision("d2", 90_000, {
					tool: "write",
					summary: ".env.local",
					verdict: "block",
					rule: ["env-files", ".env files"],
				}),
				decision("d1", 120_000, { tool: "edit", summary: "src/index.ts", verdict: "allow" }),
			],
		}),
	);
};

test.use({ viewport: { width: 1600, height: 1200 } });

test.afterEach(() => removeExtension(EXTENSION));

test("tool-guard shows the decision log and edits rules", async ({ page }) => {
	seedStore();
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");

	const status = page.getByTestId("tool-guard-status");
	await expect(status).toHaveText("2 blocked");
	await shot(status, GROUP, "10-tool-guard-status");

	await status.click();
	const panel = page.getByTestId("tool-guard-panel");
	const decisions = panel.getByTestId("tool-guard-decision");
	await expect(decisions).toHaveCount(4);
	await expect(decisions.first()).toHaveAttribute("data-verdict", "block");
	await expect(decisions.first()).toContainText("git push --force origin main");
	await expect(decisions.first()).toContainText("Release prep");
	await shot(panel, GROUP, "10-tool-guard-log");

	await panel.getByTestId("tool-guard-filter-block").click();
	await expect(decisions).toHaveCount(2);

	await panel.getByTestId("tool-guard-view-rules").click();
	const rules = panel.getByTestId("tool-guard-rule");
	await expect(rules).toHaveCount(6);

	await panel.getByTestId("tool-guard-add-pattern").fill("^npm publish");
	await panel.getByTestId("tool-guard-add-note").fill("release by hand");
	await panel.getByTestId("tool-guard-add-submit").click();
	await expect(rules).toHaveCount(7);
	await expect(rules.first()).toContainText("^npm publish");
	await expect(rules.first()).toContainText("release by hand");

	const tryInput = panel.getByTestId("tool-guard-try-input");
	const tryResult = panel.getByTestId("tool-guard-try-result");
	await tryInput.fill("cd pkg && npm publish --tag next");
	await panel.getByTestId("tool-guard-try-submit").click();
	await expect(tryResult).toHaveAttribute("data-verdict", "block");
	await expect(tryResult).toContainText("^npm publish");
	await shot(panel, GROUP, "10-tool-guard-rules");
	await shot(page, GROUP, "10-tool-guard-app");
	await rules.nth(3).scrollIntoViewIfNeeded();
	await shot(panel, GROUP, "10-tool-guard-rule-list");

	const resetHard = panel.locator('[data-testid="tool-guard-rule"][data-rule-id="git-reset-hard"]');
	await resetHard.getByTestId("tool-guard-rule-toggle").click();
	await expect(resetHard).toHaveAttribute("data-enabled", "false");
	await tryInput.fill("git reset --hard HEAD~1");
	await panel.getByTestId("tool-guard-try-submit").click();
	await expect(tryResult).toHaveAttribute("data-verdict", "allow");

	await rules.first().getByTestId("tool-guard-rule-remove").click();
	await expect(rules).toHaveCount(6);

	await panel.getByTestId("tool-guard-view-log").click();
	await panel.getByTestId("tool-guard-filter-all").click();
	await panel.getByTestId("tool-guard-clear").click();
	await expect(panel.getByTestId("tool-guard-empty")).toBeVisible();
	await expect(status).toBeHidden();
});
