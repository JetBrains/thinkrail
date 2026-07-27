import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent to make a file change, then proves the
// chat turn-divider (Task 9) — it appears the instant the turn ends (no follow-up needed), and its "files
// changed" chip deep-links the right panel's Changes view, highlighting the edited file's row (the diff
// itself opens only on an explicit click — the chip never steals the center area; see panels/SPEC.md).
// The second spec covers the divider's OTHER chip: a written spec is counted and routed as a spec, never as
// a change — the two chips mirror the Specs/Changes tab split.

test("turn-divider files-changed chip highlights the file's row in the Changes panel", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page);

	// One turn: make a real change so the round has a "files changed" entry.
	await page
		.getByTestId("chat-input")
		.fill(
			"Use the write tool to create a new file notes.txt whose only content is the line: hello",
		);
	await page.getByTestId("chat-send").click();
	// `write` is routine — it folds into an activity run. Assert the fold surfaced it by name: either the
	// collapsed group header's tally ("N steps · write …") or a single-step run's bare step row.
	await expect(
		page
			.locator('[data-testid="activity-group"], [data-testid="activity-step"]')
			.filter({ hasText: "write" })
			.first(),
	).toBeVisible({ timeout: 90_000 });
	await waitForDone(page);

	// The divider closes the round the instant it ends — no follow-up turn required.
	const chip = page.getByTestId("turn-divider-files").first();
	await expect(chip).toBeVisible({ timeout: 30_000 });
	await expect(chip).toContainText("file changed");

	// Clicking it flips the right panel to Changes and highlights notes.txt's row — no diff tab opens
	// (highlight-only deep link: the diff opens only on an explicit row click).
	await chip.click();
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");
	const row = page.getByTestId("change-item").filter({ hasText: "notes.txt" });
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toHaveCount(0);
});

test("turn-divider counts a scratch task-spec as a spec and opens it from the Specs panel", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page);

	// A task-spec in the workspace's gitignored scratch dir: real work, zero git footprint. This is the
	// regression — it used to be reported as a "changed file", deep-linking to a Changes view that
	// structurally cannot show it (`.thinkrail/context/.gitignore` is a lone `*`).
	await page
		.getByTestId("chat-input")
		.fill(
			"Use the spec_create tool to create a spec at path .thinkrail/context/TASK-divider-demo.md " +
				"with id task-divider-demo, type task-spec, title Divider demo, status draft. " +
				"Then stop — do not edit any other file.",
		);
	await page.getByTestId("chat-send").click();
	await expect(
		page
			.locator('[data-testid="activity-group"], [data-testid="activity-step"]')
			.filter({ hasText: "spec_create" })
			.first(),
	).toBeVisible({ timeout: 90_000 });
	await waitForDone(page);

	// The round reports a spec — and NO changed file, since the scratch dir has no git footprint.
	const specChip = page.getByTestId("turn-divider-specs").first();
	await expect(specChip).toBeVisible({ timeout: 30_000 });
	await expect(specChip).toContainText("1 spec");
	await expect(page.getByTestId("turn-divider-files")).toHaveCount(0);

	// Clicking it flips to Specs and opens the rendered spec (the stronger deep link: a spec doc has nothing
	// to preview short of its content), and the tree row marks the location.
	await specChip.click();
	await expect(page.getByTestId("tab-specs")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("editor-pane")).toContainText("Divider demo");
	await expect(
		page.locator('[data-testid="spec-node"][data-spec-id="task-divider-demo"]'),
	).toHaveAttribute("data-active", "true");
});

test("a multi-artifact chip expands into the round's list instead of guessing which one to open", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page);

	// Two written files in one round: the chip can no longer stand for a single deep link.
	await page
		.getByTestId("chat-input")
		.fill(
			"Use the write tool twice: create alpha.txt containing the single line alpha, then create " +
				"beta.txt containing the single line beta. Then stop.",
		);
	await page.getByTestId("chat-send").click();
	await waitForDone(page);

	const chip = page.getByTestId("turn-divider-files").first();
	await expect(chip).toBeVisible({ timeout: 30_000 });
	await expect(chip).toContainText("2 files changed");

	// Collapsed by default, and clicking discloses the set rather than deep-linking the first path. The
	// owning view is revealed alongside (that is what makes the chips read as a switch), but nothing is
	// surfaced in it yet: no diff tab, no highlighted row — the chip never picks a file for the user.
	await expect(page.getByTestId("turn-divider-files-list")).toHaveCount(0);
	await chip.click();
	const list = page.getByTestId("turn-divider-files-list");
	await expect(list).toBeVisible();
	await expect(list.getByTestId("turn-divider-files-list-item")).toHaveCount(2);
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toHaveCount(0);
	await expect(page.getByTestId("change-item").filter({ hasText: "beta.txt" })).not.toHaveAttribute(
		"data-active",
		"true",
	);

	// A row is the deep link: it flips to Changes and highlights that file — the one the user picked.
	await list.getByTestId("turn-divider-files-list-item").filter({ hasText: "beta.txt" }).click();
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");
	const row = page.getByTestId("change-item").filter({ hasText: "beta.txt" });
	await expect(row).toHaveAttribute("data-active", "true");
	await expect(
		page.getByTestId("change-item").filter({ hasText: "alpha.txt" }),
	).not.toHaveAttribute("data-active", "true");
});

test("a spec written while the Specs tab is closed still counts as a spec", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page);

	// Park the right panel on Changes, so the Specs tab body is UNMOUNTED for the whole round. The graph
	// that classifies the round's artifacts has to keep tracking the worktree anyway (the read is owned by
	// the always-mounted panel — see panels/useWorkspaceSpecs); if it stopped at the tab, a user who lives
	// in Changes would get every spec counted as a changed file, silently undoing the split.
	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");

	// Written with `write` — NOT `spec_create`, whose target counts as a spec by tool name alone — so fresh
	// graph membership is the only thing that can classify it: the snapshot has to refresh while the panel
	// rendering it is off screen.
	await page
		.getByTestId("chat-input")
		.fill(
			"Use the write tool once to create module-b/SPEC.md with exactly this content:\n" +
				"---\nid: sample-module-b\ntype: module-design\ntitle: Sample Module B\nparent: sample-root\n---\n\n" +
				"## Responsibility\n\nA second fixture module spec.\n" +
				"Do NOT use the spec_create tool — use write. Then stop.",
		);
	await page.getByTestId("chat-send").click();
	// Pin the tool actually used: if the agent reached for `spec_create`, the classification would come from
	// the tool name and this spec would pass without ever exercising the graph refresh it exists to cover.
	await expect(
		page
			.locator('[data-testid="activity-group"], [data-testid="activity-step"]')
			.filter({ hasText: "write" })
			.first(),
	).toBeVisible({ timeout: 90_000 });
	await expect(
		page.locator('[data-testid="activity-group"], [data-testid="activity-step"]').filter({
			hasText: "spec_create",
		}),
	).toHaveCount(0);
	await waitForDone(page);

	const specChip = page.getByTestId("turn-divider-specs").first();
	await expect(specChip).toBeVisible({ timeout: 30_000 });
	await expect(specChip).toContainText("1 spec");
	await expect(page.getByTestId("turn-divider-files")).toHaveCount(0);
});

test("the two artifact chips are a switch: one list at a time, and re-clicking clears the selection", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(180_000);
	await openWorkspaceChat(page);

	// A round with several artifacts on BOTH sides, so the two chips are genuine alternatives.
	await page
		.getByTestId("chat-input")
		.fill(
			"Use the write tool four times, then stop. 1) alpha.txt containing: alpha. 2) beta.txt " +
				"containing: beta. 3) docs/one/SPEC.md containing:\n" +
				"---\nid: sample-doc-one\ntype: module-design\ntitle: Doc One\nparent: sample-root\n---\n\n## Responsibility\n\nOne.\n" +
				"4) docs/two/SPEC.md containing:\n" +
				"---\nid: sample-doc-two\ntype: module-design\ntitle: Doc Two\nparent: sample-root\n---\n\n## Responsibility\n\nTwo.\n",
		);
	await page.getByTestId("chat-send").click();
	await waitForDone(page);

	const specsChip = page.getByTestId("turn-divider-specs").first();
	const filesChip = page.getByTestId("turn-divider-files").first();
	await expect(specsChip).toContainText("2 specs", { timeout: 30_000 });
	await expect(filesChip).toContainText("2 files changed");
	const specsList = page.getByTestId("turn-divider-specs-list");
	const filesList = page.getByTestId("turn-divider-files-list");

	// Choosing the specs side opens its list and reveals Specs.
	await specsChip.click();
	await expect(specsList).toBeVisible();
	await expect(filesList).toHaveCount(0);
	await expect(page.getByTestId("tab-specs")).toHaveAttribute("data-active", "true");

	// Choosing the other side REPLACES the open list (never two at once) and follows with its own view.
	await filesChip.click();
	await expect(filesList).toBeVisible();
	await expect(specsList).toHaveCount(0);
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");

	// Re-clicking the chosen side clears the selection: nothing expanded, and the panel is left where the
	// user last sent it (a close is "never mind", not another navigation).
	await filesChip.click();
	await expect(filesList).toHaveCount(0);
	await expect(specsList).toHaveCount(0);
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");
});
