import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import {
	loadPersistedWorkspaces,
	openFixtureProject,
	openWorkspaceMenu,
	revealFirstProjectWorkspaces,
	worktreeRow,
} from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

async function seedWorkspaces(
	page: Page,
	names: readonly string[],
	group?: { name: string; members: number },
): Promise<Workspace[]> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const projects = await wire.request("project.list", {});
		const project = projects.find((candidate) => candidate.kind !== "chats");
		if (!project) throw new Error("the fixture project is not open");
		const created: Workspace[] = [];
		for (const name of names) {
			created.push(await wire.request("workspace.create", { projectId: project.id, name }, 30_000));
		}
		if (group) {
			await wire.request("container.create", {
				name: group.name,
				workspaceIds: created.slice(0, group.members).map((workspace) => workspace.id),
			});
		}
		return created;
	} finally {
		wire.close();
	}
}

function containerGroup(page: Page, name: string): Locator {
	return page.getByTestId("container-group").filter({
		has: page.getByTestId("container-name").getByText(name, { exact: true }),
	});
}

function memberRow(group: Locator, name: string): Locator {
	return group.getByTestId("workspace-item").filter({
		has: group.page().getByTestId("workspace-name").getByText(name, { exact: true }),
	});
}

async function reloadConnected(page: Page): Promise<void> {
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page);
}

function markMerged(workspaceId: string): void {
	const file = join(E2E_DATA_DIR, "workspaces.json");
	const rows = JSON.parse(readFileSync(file, "utf8")) as Workspace[];
	writeFileSync(
		file,
		JSON.stringify(
			rows.map((row) =>
				row.id === workspaceId
					? {
							...row,
							review: {
								kind: "pull-request",
								number: 7,
								state: "merged",
								changedAt: Date.now(),
							},
						}
					: row,
			),
		),
	);
}

test("grouping two workspaces nests them under the container with its orchestrator, and the topbar switches members", async ({
	page,
}) => {
	await openFixtureProject(page);
	await seedWorkspaces(page, ["alpha", "beta", "gamma"]);
	await reloadConnected(page);

	await openWorkspaceMenu(worktreeRow(page, "alpha"));
	await page.getByTestId("workspace-group").click();
	const dialog = page.getByTestId("container-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("container-attach-option")).toHaveCount(2);
	await dialog.getByTestId("container-name-field").fill("Board work");
	await dialog.getByTestId("container-attach-option").filter({ hasText: "beta" }).click();
	await dialog.getByTestId("container-workspace-submit").click();
	await expect(dialog).toHaveCount(0);

	const board = containerGroup(page, "Board work");
	await expect(board).toBeVisible();
	await expect(board.getByTestId("container-member-count")).toHaveText("2");
	await expect(memberRow(board, "alpha")).toBeVisible();
	await expect(memberRow(board, "beta")).toBeVisible();
	await expect(worktreeRow(page, "alpha")).toHaveCount(1);
	await expect(worktreeRow(page, "beta")).toHaveCount(1);
	await expect(worktreeRow(page, "gamma")).toHaveCount(1);
	await expect(board.getByTestId("workspace-item").filter({ hasText: "gamma" })).toHaveCount(0);
	await expect(board.getByTestId("container-orchestrator")).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId("chat-item")).toHaveCount(0);
	await expect(page.getByTestId("containers-section")).toHaveCount(0);

	await memberRow(board, "alpha").getByRole("treeitem").click();
	await expect(memberRow(board, "alpha")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("scope-project-segment")).toHaveCount(0);
	await expect(page.getByTestId("scope-container-name")).toHaveText("Board work");
	await expect(page.getByTestId("scope-name")).toHaveText("alpha");

	await page.getByTestId("scope-container").click();
	const menu = page.getByTestId("scope-container-menu");
	await expect(menu.getByTestId("scope-container-member")).toHaveCount(2);
	await expect(menu.getByTestId("scope-container-orchestrator")).toBeVisible();
	await expect(menu.getByTestId("scope-container-add")).toBeVisible();
	await expect(menu.getByTestId("scope-container-remove")).toBeVisible();
	await menu.getByTestId("scope-container-member").filter({ hasText: "beta" }).click();
	await expect(memberRow(board, "beta")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("scope-name")).toHaveText("beta");

	await page.getByTestId("scope-container").click();
	await page
		.getByTestId("scope-container-menu")
		.getByTestId("scope-container-orchestrator")
		.click();
	await expect(board.getByTestId("container-orchestrator")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	await expect(page.getByTestId("scope-container-name")).toHaveText("Board work");

	await worktreeRow(page, "gamma").getByRole("treeitem").click();
	await expect(page.getByTestId("scope-container-segment")).toHaveCount(0);
	await expect(page.getByTestId("scope-project-name")).toHaveText("sample-project");

	const boardId = await board.getAttribute("data-container-id");
	const pinned = page.locator(`[data-testid="container-group"][data-container-id="${boardId}"]`);
	await pinned.getByTestId("container-item").click({ button: "right" });
	await page.getByTestId("container-menu-rename").click();
	const nameInput = pinned.getByTestId("container-name-input");
	await expect(nameInput).toBeFocused();
	await nameInput.fill("Board stack");
	await nameInput.press("Enter");
	const renamed = containerGroup(page, "Board stack");
	await expect(renamed).toBeVisible();

	const containerName = renamed.getByTestId("container-name");
	await containerName.focus();
	await expect(containerName).toHaveAttribute("aria-expanded", "true");
	await page.keyboard.press("ArrowLeft");
	await expect(renamed.getByTestId("container-item")).toHaveAttribute("data-collapsed", "true");
	await expect(renamed.getByTestId("workspace-item")).toHaveCount(0);
	await reloadConnected(page);
	await expect(containerGroup(page, "Board stack").getByTestId("container-item")).toHaveAttribute(
		"data-collapsed",
		"true",
	);
	await containerGroup(page, "Board stack").getByTestId("container-name").click();
	await expect(memberRow(containerGroup(page, "Board stack"), "alpha")).toBeVisible();
});

test("a container takes a stacked workspace and an attached one, then is removed with a choice per member", async ({
	page,
}) => {
	await openFixtureProject(page);
	const [alpha, , gamma] = await seedWorkspaces(page, ["alpha", "beta", "gamma"], {
		name: "Board work",
		members: 2,
	});
	if (!alpha || !gamma) throw new Error("seeded workspaces are missing");
	await reloadConnected(page);
	const board = containerGroup(page, "Board work");
	await expect(board.getByTestId("workspace-item")).toHaveCount(2);
	await memberRow(board, "alpha").getByRole("treeitem").click();

	const before = new Set(loadPersistedWorkspaces().map((workspace) => workspace.id));
	await page.getByTestId("scope-container").click();
	await page.getByTestId("scope-container-add").click();
	const dialog = page.getByTestId("container-workspace-dialog");
	await dialog.getByTestId("container-add-mode-stack").click();
	await dialog.getByTestId("container-stack-option").filter({ hasText: "alpha" }).click();
	await dialog.getByTestId("container-workspace-submit").click();
	await expect(dialog).toHaveCount(0);
	await expect(board.getByTestId("workspace-item")).toHaveCount(3, { timeout: 60_000 });
	const stacked = loadPersistedWorkspaces().find((workspace) => !before.has(workspace.id));
	expect(stacked?.baseBranch).toBe(alpha.branch);
	if (!stacked) throw new Error("the stacked workspace was not persisted");

	await board.getByTestId("container-item").click({ button: "right" });
	await page.getByTestId("container-menu-add-workspace").click();
	await dialog.getByTestId("container-add-mode-attach").click();
	await expect(dialog.getByTestId("container-attach-option")).toHaveCount(1);
	await dialog.getByTestId("container-attach-option").filter({ hasText: "gamma" }).click();
	await dialog.getByTestId("container-workspace-submit").click();
	await expect(dialog).toHaveCount(0);
	await expect(board.getByTestId("workspace-item")).toHaveCount(4);
	await expect(memberRow(board, "gamma")).toBeVisible();

	markMerged(gamma.id);
	await reloadConnected(page);
	await page.getByTestId("scope-container").click();
	await page.getByTestId("scope-container-remove").click();
	const remove = page.getByTestId("remove-container-dialog");
	await expect(remove.getByTestId("remove-container-member")).toHaveCount(4);
	await expect(remove.getByTestId("remove-container-trash")).toContainText("Trash");
	const member = (id: string) => remove.locator(`[data-member-id="${id}"]`);
	await expect(member(gamma.id).getByTestId("remove-container-merged")).toBeVisible();
	await expect(member(alpha.id).getByTestId("remove-container-keep")).toHaveAttribute(
		"data-active",
		"true",
	);
	const beta = loadPersistedWorkspaces().find((workspace) => workspace.name === "beta");
	if (!beta) throw new Error("beta is missing");
	await member(beta.id).getByTestId("remove-container-archive").click();
	await remove.getByTestId("confirm-remove-container").click();
	await expect(remove).toHaveCount(0);

	await expect(page.getByTestId("container-group")).toHaveCount(0);
	await expect(worktreeRow(page, "alpha")).toBeVisible();
	await expect(worktreeRow(page, stacked.name)).toBeVisible();
	await expect(worktreeRow(page, "beta")).toHaveCount(0);
	await expect(worktreeRow(page, "gamma")).toHaveCount(0);
	await expect(page.getByTestId("scope-project-name")).toHaveText("sample-project");
	await expect(page.getByTestId("chat-item")).toHaveCount(0);
	const kept = loadPersistedWorkspaces().map((workspace) => workspace.id);
	expect(kept).toContain(alpha.id);
	expect(kept).toContain(stacked.id);
	expect(kept).not.toContain(beta.id);
	expect(kept).not.toContain(gamma.id);
});
