import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

test("turn-divider files-changed chip opens the file's diff and highlights its row in Changes", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page);

	await page
		.getByTestId("chat-input")
		.fill(
			"Use the write tool to create a new file notes.txt whose only content is the line: hello",
		);
	await page.getByTestId("chat-send").click();
	await expect(
		page
			.locator('[data-testid="activity-group"], [data-testid="activity-step"]')
			.filter({ hasText: "write" })
			.first(),
	).toBeVisible({ timeout: 90_000 });
	await waitForDone(page);

	const chip = page.getByTestId("turn-divider-files").first();
	await expect(chip).toBeVisible({ timeout: 30_000 });
	await expect(chip).toContainText("file changed");

	await chip.click();
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");
	const row = page.getByTestId("change-item").filter({ hasText: "notes.txt" });
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toBeVisible();
});

test("turn-divider counts a scratch task-spec as a spec and opens it from the Specs panel", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page);

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

	const specChip = page.getByTestId("turn-divider-specs").first();
	await expect(specChip).toBeVisible({ timeout: 30_000 });
	await expect(specChip).toContainText("1 spec");
	await expect(page.getByTestId("turn-divider-files")).toHaveCount(0);

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

	await list.getByTestId("turn-divider-files-list-item").filter({ hasText: "beta.txt" }).click();
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toBeVisible();
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

	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");

	await page
		.getByTestId("chat-input")
		.fill(
			"Use the write tool once to create module-b/SPEC.md with exactly this content:\n" +
				"---\nid: sample-module-b\ntype: module-design\ntitle: Sample Module B\nparent: sample-root\n---\n\n" +
				"## Responsibility\n\nA second fixture module spec.\n" +
				"Do NOT use the spec_create tool — use write. Then stop.",
		);
	await page.getByTestId("chat-send").click();
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

	await specsChip.click();
	await expect(specsList).toBeVisible();
	await expect(filesList).toHaveCount(0);
	await expect(page.getByTestId("tab-specs")).toHaveAttribute("data-active", "true");

	await filesChip.click();
	await expect(filesList).toBeVisible();
	await expect(specsList).toHaveCount(0);
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");

	await filesChip.click();
	await expect(filesList).toHaveCount(0);
	await expect(specsList).toHaveCount(0);
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");
});
