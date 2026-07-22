import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, stageHookProject } from "./fixtures/app";

// Real host, real git commits to the project's root checkout, real `sh -c`/`sh <script>` subprocesses — no
// agent needed. Covers the tiered shared/local hooks dialog (combine-mode, inline/script toggle,
// approve-on-save, gitignore handling, per-workspace mode override) end to end against a real repo.

test.describe("project hooks config", () => {
	test("the gear icon and the Welcome 'Configure hooks' card both open the dialog with zero workspaces", async ({
		page,
	}) => {
		stageHookProject({});
		await page.goto("/");
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		// Welcome card, reachable before any workspace exists.
		await page.getByTestId("welcome-action").filter({ hasText: "Configure hooks" }).click();
		await expect(page.getByTestId("project-hooks-dialog")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("project-hooks-dialog")).not.toBeVisible();

		// Gear icon on the project row.
		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await expect(page.getByTestId("project-hooks-dialog")).toBeVisible();
	});

	test("a multi-line inline command survives save and reopen (no newline fusion)", async ({
		page,
	}) => {
		stageHookProject({});
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();

		// The old widget was a single-line `<input>`, which a browser silently fuses multi-line text into —
		// the confirmed data-corruption bug this rebuild fixes. The field is now a `<textarea>`, which must
		// carry a real embedded newline through fill → save → server round trip → reopen unmolested.
		const script = "echo line-one\necho line-two";
		const field = page.getByTestId("hook-shared-onCreate");
		await field.fill(script);
		await expect(field).toHaveValue(script);
		expect(await field.inputValue()).toContain("\n");

		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("hook-approved-shared-onCreate")).toHaveText("Approved");
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("project-hooks-dialog")).not.toBeVisible();

		// Reopen — a fresh `project.hooks.get`, not just the in-memory post-save state — and confirm the
		// newline is still there.
		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		const reopened = page.getByTestId("hook-shared-onCreate");
		await expect(reopened).toHaveValue(script);
		expect(await reopened.inputValue()).toContain("\n");
	});

	test("a Shared script hook runs for a workspace created afterward", async ({ page }) => {
		stageHookProject({}, { scripts: { ".thinkrail/hooks/setup.sh": "echo script-hook-ran\n" } });
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();

		// Switch Shared/onCreate to Script mode and point it at the fixture's committed script.
		await page.getByTestId("hook-shared-mode-onCreate-script").click();
		await expect(page.getByTestId("hook-shared-mode-onCreate-script")).toHaveAttribute(
			"data-active",
			"true",
		);
		await page.getByTestId("hook-shared-onCreate").fill(".thinkrail/hooks/setup.sh");
		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("hook-approved-shared-onCreate")).toHaveText("Approved");
		await page.keyboard.press("Escape");

		await createWorkspaceViaDialog(page);
		const row = page.getByTestId("workspace-item").first();
		const badge = row.getByTestId("workspace-hook-badge");
		await expect(badge).toHaveAttribute("data-hook-status", "succeeded", { timeout: 10_000 });

		await row.click();
		await page.getByTestId("tab-hooks").click();
		const hookRow = page.getByTestId("hook-row").filter({ hasText: "onCreate" });
		await expect(hookRow).toHaveAttribute("data-status", "succeeded");
		await expect(hookRow.getByTestId("hook-command-shared")).toContainText(
			"script: .thinkrail/hooks/setup.sh",
		);
		await expect(hookRow.getByTestId("hook-output")).toContainText("script-hook-ran");
	});

	test("combine-mode both runs Shared then Local for a created workspace", async ({ page }) => {
		stageHookProject({});
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();

		await page.getByTestId("hook-combine-mode-both").click();
		await expect(page.getByTestId("hook-combine-mode-both")).toHaveAttribute("data-active", "true");
		await page.getByTestId("hook-shared-onCreate").fill("echo shared-ran");
		await page.getByTestId("hook-local-onCreate").fill("echo local-ran");
		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("hook-approved-shared-onCreate")).toHaveText("Approved");
		await expect(page.getByTestId("hook-approved-local-onCreate")).toHaveText("Approved");
		await page.keyboard.press("Escape");

		await createWorkspaceViaDialog(page);
		const row = page.getByTestId("workspace-item").first();
		await expect(row.getByTestId("workspace-hook-badge")).toHaveAttribute(
			"data-hook-status",
			"succeeded",
			{ timeout: 10_000 },
		);

		await row.click();
		await page.getByTestId("tab-hooks").click();
		const hookRow = page.getByTestId("hook-row").filter({ hasText: "onCreate" });
		// Both tiers reported and both succeeded — `both` ran Shared *and* Local, not one or the other.
		await expect(hookRow.getByTestId("hook-command-shared")).toHaveAttribute(
			"data-status",
			"succeeded",
		);
		await expect(hookRow.getByTestId("hook-command-local")).toHaveAttribute(
			"data-status",
			"succeeded",
		);
	});

	test("save approves the hook, so a workspace created afterward runs without a separate Approve click", async ({
		page,
	}) => {
		stageHookProject({});
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await page.getByTestId("hook-shared-onCreate").fill("echo configured-via-ui");
		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("hook-approved-shared-onCreate")).toHaveText("Approved");
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("project-hooks-dialog")).not.toBeVisible();

		await createWorkspaceViaDialog(page);
		// No lingering `awaitingApproval` and no separate approve click — saving already approved this exact
		// command on this machine, so the badge converges straight through to succeeded.
		const badge = page.getByTestId("workspace-item").first().getByTestId("workspace-hook-badge");
		await expect(badge).toHaveAttribute("data-hook-status", "succeeded", { timeout: 10_000 });
	});

	test("a gitignored .thinkrail/ disables Shared but Local still saves and runs", async ({
		page,
	}) => {
		stageHookProject({}, { gitignoreThinkrail: true });
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await expect(page.getByTestId("shared-uncommittable-note")).toBeVisible();
		await expect(page.getByTestId("hook-shared-onCreate")).toBeDisabled();

		await page.getByTestId("hook-local-onCreate").fill("echo local-only-ran");
		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("hook-approved-local-onCreate")).toHaveText("Approved");
		await page.keyboard.press("Escape");

		await createWorkspaceViaDialog(page);
		const row = page.getByTestId("workspace-item").first();
		await expect(row.getByTestId("workspace-hook-badge")).toHaveAttribute(
			"data-hook-status",
			"succeeded",
			{ timeout: 10_000 },
		);

		await row.click();
		await page.getByTestId("tab-hooks").click();
		const hookRow = page.getByTestId("hook-row").filter({ hasText: "onCreate" });
		await expect(hookRow.getByTestId("hook-command-local")).toBeVisible();
		await expect(hookRow.getByTestId("hook-command-shared")).toHaveCount(0);
	});

	test("per-workspace hook mode 'shared' skips the Local hook even when both exist", async ({
		page,
	}) => {
		stageHookProject({});
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await page.getByTestId("hook-shared-onCreate").fill("echo shared-mode-ran");
		await page.getByTestId("hook-local-onCreate").fill("echo local-mode-ran");
		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("hook-approved-shared-onCreate")).toHaveText("Approved");
		await expect(page.getByTestId("hook-approved-local-onCreate")).toHaveText("Approved");
		await page.keyboard.press("Escape");

		// Create via the raw dialog flow (not `createWorkspaceViaDialog`, which never touches the Advanced
		// disclosure) so the per-workspace hook-mode override can be picked before creating.
		await page.getByTestId("add-workspace").first().click();
		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeVisible();
		await expect(page.getByTestId("ws-advanced-toggle")).toBeVisible();
		await page.getByTestId("ws-advanced-toggle").click();
		await page.getByTestId("ws-hook-mode-shared").click();
		await expect(page.getByTestId("ws-hook-mode-shared")).toHaveAttribute("data-active", "true");
		await page.getByTestId("create-workspace").click();
		await expect(dialog).toBeHidden();

		const row = page.getByTestId("workspace-item").first();
		await expect(row.getByTestId("workspace-hook-badge")).toHaveAttribute(
			"data-hook-status",
			"succeeded",
			{ timeout: 10_000 },
		);

		await row.click();
		await page.getByTestId("tab-hooks").click();
		const hookRow = page.getByTestId("hook-row").filter({ hasText: "onCreate" });
		await expect(hookRow.getByTestId("hook-command-shared")).toBeVisible();
		// Local was never even attempted — the workspace's `hookCombineMode: "shared"` override excludes it
		// entirely, it isn't just skipped mid-run.
		await expect(hookRow.getByTestId("hook-command-local")).toHaveCount(0);
	});

	test("removing a Shared onCreate via the × clears it so a later workspace doesn't run it", async ({
		page,
	}) => {
		stageHookProject({});
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await page.getByTestId("hook-shared-onCreate").fill("echo remove-me");
		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("hook-approved-shared-onCreate")).toHaveText("Approved");
		await page.keyboard.press("Escape");

		// Reopen, remove it via the × (not a blank-to-delete), save.
		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await expect(page.getByTestId("hook-shared-onCreate")).toHaveValue("echo remove-me");
		await page.getByTestId("hook-shared-remove-onCreate").click();
		await expect(page.getByTestId("hook-shared-onCreate")).toHaveValue("");
		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("hook-shared-onCreate")).toHaveValue("");
		await page.keyboard.press("Escape");

		// Reopen once more — a fresh GET — to confirm it's gone for good, not just cleared client-side.
		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await expect(page.getByTestId("hook-shared-onCreate")).toHaveValue("");
		await page.keyboard.press("Escape");

		await createWorkspaceViaDialog(page);
		const row = page.getByTestId("workspace-item").first();
		// Nothing declared for onCreate (Shared cleared, Local never set) ⇒ no entries ever run for it, so
		// `Workspace.hookStatus` never gains an `onCreate` key at all — no badge, not even a transient one.
		await expect(row.getByTestId("workspace-hook-badge")).toHaveCount(0);
	});

	test("removing a workspace with an unapproved onDelete surfaces a toast instead of failing silently", async ({
		page,
	}) => {
		stageHookProject({ onCreate: "true", onDelete: "echo tearing-down" });
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		// Approve onCreate only (via the reactive badge flow), leaving onDelete unapproved.
		await createWorkspaceViaDialog(page);
		const row = page.getByTestId("workspace-item").first();
		const badge = row.getByTestId("workspace-hook-badge");
		await expect(badge).toHaveAttribute("data-hook-status", "awaitingApproval");
		await badge.click();
		await page.getByTestId("confirm-approve-hook").click();
		await expect(badge).toHaveAttribute("data-hook-status", "succeeded", { timeout: 10_000 });

		// Remove it — onDelete was never approved, so it should be skipped, and the skip should be visible.
		await row.getByTestId("workspace-remove").click();
		await page.getByTestId("confirm-remove").click();
		await expect(
			page.getByTestId("toast").filter({ hasText: "onDelete" }).filter({ hasText: "approval" }),
		).toBeVisible({ timeout: 10_000 });
	});
});
