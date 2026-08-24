import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fsExpect = expect.configure({ timeout: 10_000 });

test("worktree changes on disk appear live in Specs, All files, Changes, and an open file tab", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const worktree = workspace.worktreePath;

	await expect(page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]')).toBeVisible();
	mkdirSync(join(worktree, "module-live"), { recursive: true });
	writeFileSync(
		join(worktree, "module-live", "SPEC.md"),
		"---\nid: sample-live\ntype: module-design\ntitle: Live Module\nparent: sample-root\n---\n\n## Responsibility\n\nWritten on disk mid-session by the e2e suite.\n",
	);
	await fsExpect(
		page.locator('[data-testid="spec-node"][data-spec-id="sample-live"]'),
	).toBeVisible();

	await page.getByTestId("tab-files").click();
	const freshFile = page.getByTestId("file-node").filter({ hasText: "fresh-file.txt" });
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
	writeFileSync(join(worktree, "fresh-file.txt"), "hello\n");
	await fsExpect(freshFile).toBeVisible();
	rmSync(join(worktree, "fresh-file.txt"));
	await fsExpect(freshFile).toHaveCount(0);

	await page.getByTestId("tab-changes").click();
	const readmeRow = page.getByTestId("change-item").filter({ hasText: "README.md" });
	await expect(
		page.getByTestId("change-item").filter({ hasText: "SPEC.md" }).first(),
	).toBeVisible();
	await expect(readmeRow).toHaveCount(0);
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited live by e2e\n");
	await fsExpect(readmeRow).toHaveAttribute("data-status", "modified");
	await readmeRow.click();
	await expect(page.getByTestId("diff-pane")).toContainText("edited live by e2e");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited twice by e2e\n");
	await fsExpect(page.getByTestId("diff-pane")).toContainText("edited twice by e2e");

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("edited twice by e2e");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nlive tab reload\n");
	await fsExpect(page.getByTestId("editor-pane")).toContainText("live tab reload");
	await fsExpect(page.getByTestId("editor-pane")).not.toContainText("edited twice by e2e");
});

test("churn canary: a write storm coalesces to a few frames and the host stays responsive", async ({
	page,
	baseURL,
}) => {
	const fsFrameTimes: number[] = [];
	page.on("websocket", (ws) => {
		ws.on("framereceived", (frame) => {
			const payload = typeof frame.payload === "string" ? frame.payload : frame.payload.toString();
			if (payload.includes('"channel":"workspace.fsChanged"')) fsFrameTimes.push(Date.now());
		});
	});

	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const worktree = workspace.worktreePath;

	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
	await sleep(1200);
	const framesBefore = fsFrameTimes.length;

	mkdirSync(join(worktree, "storm"), { recursive: true });
	let healthMs = -1;
	for (let burst = 0; burst < 20; burst++) {
		for (let i = 0; i < 10; i++) {
			writeFileSync(join(worktree, "storm", `f-${burst}-${i}.txt`), `${burst}:${i}\n`);
		}
		if (burst === 10) {
			const t0 = performance.now();
			const res = await fetch(`${baseURL}/health`);
			healthMs = performance.now() - t0;
			expect(res.ok).toBe(true);
		}
		await sleep(150);
	}
	writeFileSync(join(worktree, "storm-done.txt"), "done\n");
	await expect(page.getByTestId("file-node").filter({ hasText: "storm-done.txt" })).toBeVisible();
	await sleep(1500);

	await page.getByTestId("file-node").filter({ hasText: "storm" }).first().click();
	await expect(page.getByTestId("file-node").filter({ hasText: "f-19-9.txt" })).toBeVisible();

	const stormFrames = fsFrameTimes.length - framesBefore;
	expect(stormFrames).toBeGreaterThanOrEqual(2);
	expect(stormFrames).toBeLessThanOrEqual(8);
	expect(healthMs).toBeGreaterThanOrEqual(0);
	expect(healthMs).toBeLessThan(1000);
});
