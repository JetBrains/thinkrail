import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

async function proxyOneSpecGraphFailure(page: Page) {
	let armed = false;
	let injected = false;
	let readCount = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: { id?: string; method?: string };
			try {
				frame = JSON.parse(raw) as typeof frame;
			} catch {
				server.send(message);
				return;
			}
			if (frame.id && frame.method === "spec.graph") {
				readCount += 1;
				if (armed && !injected) {
					injected = true;
					ws.send(JSON.stringify({ id: frame.id, ok: false, error: "injected spec failure" }));
					return;
				}
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
	return {
		arm: () => {
			armed = true;
		},
		readCount: () => readCount,
		wasInjected: () => injected,
	};
}

test("Specs tab renders the worktree's spec tree and opens a spec as an editor tab", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	const tabs = page.locator('[data-testid="tab-specs"], [data-testid="tab-files"]');
	await expect(tabs.first()).toHaveAttribute("data-testid", "tab-specs");
	await expect(page.getByTestId("tab-specs")).toHaveAttribute("data-active", "true");

	const root = page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]');
	const child = page.locator('[data-testid="spec-node"][data-spec-id="sample-module"]');
	await expect(root).toHaveAttribute("data-depth", "0");
	await expect(root).toHaveAttribute("data-main-spec", "true");
	await expect(root).toHaveAttribute("data-spec-role", "Main spec");
	await expect(root.getByTestId("spec-role")).toBeHidden();
	await root.hover();
	await expect(root.getByTestId("spec-role")).toBeVisible();
	await expect(root.getByTestId("spec-role")).toHaveText("Main spec");
	await expect(child).toHaveAttribute("data-depth", "1");
	await expect(child).toHaveAttribute("data-spec-role", "MODULE");
	await expect(child.getByTestId("spec-role")).toBeHidden();
	await child.hover();
	await expect(child.getByTestId("spec-role")).toBeVisible();
	await expect(child.getByTestId("spec-role")).toHaveText("MODULE");

	expect(await child.getAttribute("data-status")).toBeNull();
	await expect(child).not.toContainText("active");
	await expect(page.getByTestId("spec-status")).toHaveCount(0);
	await expect(page.getByTestId("spec-tree-branch")).toHaveCount(0);
	await expect(page.getByTestId("spec-tree-rail")).toHaveCount(0);
	const rootLeft = await root.evaluate((element) => element.getBoundingClientRect().left);
	const childLeft = await child.evaluate((element) => element.getBoundingClientRect().left);
	expect(childLeft - rootLeft).toBeGreaterThanOrEqual(10);
	expect(
		await root.evaluate((element) => element.getBoundingClientRect().height),
	).toBeLessThanOrEqual(30);

	await root.click();
	await expect(page.getByTestId("editor-pane")).toContainText("throwaway fixture project");
	await expect(root).toHaveAttribute("data-active", "true");
	await expect(child).toBeVisible();

	const rootToggle = page.locator("li", { has: root }).getByTestId("spec-toggle").first();
	await rootToggle.click();
	await expect(child).toHaveCount(0);
	await rootToggle.click();
	await expect(child).toBeVisible();

	await child.click();
	await expect(page.getByTestId("editor-pane")).toContainText("sample-root");
	await expect(child).toHaveAttribute("data-active", "true");
	await expect(root).toHaveAttribute("data-active", "false");

	const worktree = workspace.worktreePath;
	mkdirSync(join(worktree, "module-b"), { recursive: true });
	writeFileSync(
		join(worktree, "module-b", "SPEC.md"),
		"---\nid: sample-module-b\ntype: module-design\ntitle: Sample Module B\nparent: sample-root\n---\n\n## Responsibility\n\nAdded mid-session by the e2e suite.\n",
	);
	mkdirSync(join(worktree, "module-a", "submodule"), { recursive: true });
	writeFileSync(
		join(worktree, "module-a", "submodule", "SPEC.md"),
		"---\nid: sample-submodule\ntype: submodule-design\ntitle: Sample Submodule\nparent: sample-module\n---\n\n## Responsibility\n\nNested beneath the first module.\n",
	);
	const moduleB = page.locator('[data-testid="spec-node"][data-spec-id="sample-module-b"]');
	const submodule = page.locator('[data-testid="spec-node"][data-spec-id="sample-submodule"]');
	await expect(moduleB).toBeVisible();
	await expect(submodule).toBeVisible();
	await expect(page.getByRole("button", { name: "Refresh specs" })).toHaveCount(0);
	await expect(page.getByTestId("specs-retry")).toHaveCount(0);
	const stripBottom = await page
		.getByTestId("right-tab-strip")
		.evaluate((element) => element.getBoundingClientRect().bottom);
	const rootTop = await root.evaluate((element) => element.getBoundingClientRect().top);
	expect(rootTop - stripBottom).toBeLessThanOrEqual(24);
	await expect(submodule).toHaveAttribute("data-depth", "2");
	await expect(submodule).toHaveAttribute("data-spec-role", "SUBMODULE");
	await expect(submodule.getByTestId("spec-role")).toBeHidden();
	await submodule.hover();
	await expect(submodule.getByTestId("spec-role")).toBeVisible();
	await expect(submodule.getByTestId("spec-role")).toHaveText("SUBMODULE");
	const childLeftAfterUpdate = await child.evaluate(
		(element) => element.getBoundingClientRect().left,
	);
	const moduleBLeft = await moduleB.evaluate((element) => element.getBoundingClientRect().left);
	const submoduleLeft = await submodule.evaluate((element) => element.getBoundingClientRect().left);
	expect(Math.abs(moduleBLeft - childLeftAfterUpdate)).toBeLessThanOrEqual(1);
	expect(submoduleLeft - childLeftAfterUpdate).toBeGreaterThanOrEqual(10);
	await expect(page.getByTestId("spec-tree-branch")).toHaveCount(0);
	await expect(page.getByTestId("spec-tree-rail")).toHaveCount(0);
});

test("Specs offers Retry only after its automatic graph read fails", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const root = page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]');
	await expect(root).toBeVisible();

	const failure = await proxyOneSpecGraphFailure(page);
	failure.arm();
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	const error = page.getByTestId("specs-error");
	const retry = error.getByRole("button", { name: "Retry", exact: true });
	await expect(error).toContainText("Couldn't load specs.");
	await expect(page.getByRole("button", { name: "Refresh specs" })).toHaveCount(0);
	await expect(page.getByTestId("right-panel").getByTestId("skeleton-rows")).toHaveCount(0);
	const failedReadCount = failure.readCount();
	await retry.click();
	await expect.poll(failure.readCount).toBeGreaterThan(failedReadCount);
	await expect(page.getByTestId("specs-error")).toHaveCount(0);
	await expect(root).toBeVisible();
	expect(failure.wasInjected()).toBe(true);
});

test("a failed automatic Specs update keeps the previous tree until Retry succeeds", async ({
	page,
}) => {
	const failure = await proxyOneSpecGraphFailure(page);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]');
	await expect(root).toBeVisible();

	const added = page.locator('[data-testid="spec-node"][data-spec-id="sample-retry"]');
	failure.arm();
	writeFileSync(
		join(workspace.worktreePath, "module-a", "retry.md"),
		"---\nid: sample-retry\ntype: module-design\ntitle: Retry Sample\nparent: sample-root\n---\n\n## Responsibility\n\nAdded after the initial graph read.\n",
	);

	const error = page.getByTestId("specs-error");
	const retry = error.getByRole("button", { name: "Retry", exact: true });
	await expect(error).toContainText("Couldn't update specs.");
	await expect(retry).toBeVisible();
	await expect(root).toBeVisible();
	await expect(added).toHaveCount(0);
	await expect(page.getByTestId("right-panel").getByTestId("skeleton-rows")).toHaveCount(0);
	const failedReadCount = failure.readCount();
	await retry.click();
	await expect.poll(failure.readCount).toBeGreaterThan(failedReadCount);
	await expect(page.getByTestId("specs-error")).toHaveCount(0);
	await expect(root).toBeVisible();
	await expect(added).toBeVisible();
	expect(failure.wasInjected()).toBe(true);
});
