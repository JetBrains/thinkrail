import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Live refresh: the host watches the active worktree (recursive fs.watch → a debounced
// `workspace.fsChanged` push) and the panels silently re-read — so files/specs/git changes made
// OUTSIDE the app (Finder, a terminal, the agent) appear with no manual refresh anywhere. The watcher
// starts lazily on the workspace's first read, which panel-mount itself triggers.
test("worktree changes on disk appear live in Specs, All files, Changes, and an open file tab", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const worktree = workspace.worktreePath;

	// --- Specs (the right rail's default tab): a spec written on disk appears — no Refresh click.
	await expect(page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]')).toBeVisible();
	mkdirSync(join(worktree, "module-live"), { recursive: true });
	writeFileSync(
		join(worktree, "module-live", "SPEC.md"),
		"---\nid: sample-live\ntype: module-design\ntitle: Live Module\nparent: sample-root\n---\n\n## Responsibility\n\nWritten on disk mid-session by the e2e suite.\n",
	);
	await expect(page.locator('[data-testid="spec-node"][data-spec-id="sample-live"]')).toBeVisible();

	// --- All files: an added file appears; a deleted one drops out.
	await page.getByTestId("tab-files").click();
	const freshFile = page.getByTestId("file-node").filter({ hasText: "fresh-file.txt" });
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
	writeFileSync(join(worktree, "fresh-file.txt"), "hello\n");
	await expect(freshFile).toBeVisible();
	rmSync(join(worktree, "fresh-file.txt"));
	await expect(freshFile).toHaveCount(0);

	// --- Changes: a tracked-file edit surfaces while the tab is open, and the open Monaco diff tab
	// follows further edits (DiffPane re-reads both sides on the workspace's fs tick).
	await page.getByTestId("tab-changes").click();
	const readmeRow = page.getByTestId("change-item").filter({ hasText: "README.md" });
	await expect(
		page.getByTestId("change-item").filter({ hasText: "SPEC.md" }).first(),
	).toBeVisible();
	await expect(readmeRow).toHaveCount(0);
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited live by e2e\n");
	await expect(readmeRow).toHaveAttribute("data-status", "modified");
	await readmeRow.click();
	await expect(page.getByTestId("diff-pane")).toContainText("edited live by e2e");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited twice by e2e\n");
	await expect(page.getByTestId("diff-pane")).toContainText("edited twice by e2e");

	// --- Open file tab: the visible tab's content follows the disk (the viewer is read-only, so a
	// silent swap is conflict-free).
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("edited twice by e2e");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nlive tab reload\n");
	await expect(page.getByTestId("editor-pane")).toContainText("live tab reload");
	await expect(page.getByTestId("editor-pane")).not.toContainText("edited twice by e2e");
});

// Performance canary: live refresh must never turn a write storm into a message/refetch storm. The
// host's coalescer bounds pushes to ≤ ~1 frame/sec/workspace (300ms quiet / 1s max-wait), so ~200
// rapid writes over ~3s must reach the client as a HANDFUL of `workspace.fsChanged` frames — not 200 —
// while the host's event loop stays responsive (a mid-storm /health round-trip) and the UI still
// converges on the final state. If the debounce ever regresses, the frame-count bound trips.
test("churn canary: a write storm coalesces to a few frames and the host stays responsive", async ({
	page,
	baseURL,
}) => {
	// Tap the app's WebSocket before it connects: count pushed fsChanged frames as the browser sees them.
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

	// Watch the tree live so the storm also exercises the client refetch path, then let the watcher's
	// startup nudge pass so the storm window counts only storm-driven frames.
	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
	await sleep(1200);
	const framesBefore = fsFrameTimes.length;

	// The storm: 20 bursts × 10 files, 150ms apart (≈ 3s of sustained churn — gaps shorter than the
	// 300ms quiet window, so only the 1s max-wait can flush). Probe the host mid-storm.
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
	// Marker write + settle: everything pending has flushed well within this window.
	writeFileSync(join(worktree, "storm-done.txt"), "done\n");
	await expect(page.getByTestId("file-node").filter({ hasText: "storm-done.txt" })).toBeVisible();
	await sleep(1500);

	// The UI converged: the storm dir is present and expandable to its files.
	await page.getByTestId("file-node").filter({ hasText: "storm" }).first().click();
	await expect(page.getByTestId("file-node").filter({ hasText: "f-19-9.txt" })).toBeVisible();

	// The bounds: ~201 writes reached the client as a handful of frames (debounce held — a regression to
	// per-event pushes would show hundreds), batching actually happened repeatedly (≥ 2 flushes across a
	// 3s storm — the max-wait bound), and the host answered mid-storm without event-loop starvation.
	const stormFrames = fsFrameTimes.length - framesBefore;
	expect(stormFrames).toBeGreaterThanOrEqual(2);
	expect(stormFrames).toBeLessThanOrEqual(8);
	expect(healthMs).toBeGreaterThanOrEqual(0);
	expect(healthMs).toBeLessThan(1000);
});
