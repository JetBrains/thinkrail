import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import {
	openAppFresh,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

interface ClientFrame {
	method?: string;
	params?: { text?: string };
}

function storedChats(): { container: { kind: string } | null; chats: Workspace[] } {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "chats.json"), "utf8"));
}

function chatFolders(): string[] {
	const root = join(E2E_DATA_DIR, "chats");
	return existsSync(root) ? readdirSync(root).filter((name) => !name.startsWith(".")) : [];
}

async function observeClientFrames(page: Page, frames: ClientFrame[]): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		socket.onMessage((message) => {
			try {
				frames.push(JSON.parse(String(message)) as ClientFrame);
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => socket.send(message));
	});
}

test("with no project open, the Welcome starts a chat without a project: its own folder under Chats, no git tools", async ({
	page,
}) => {
	await openAppFresh(page);
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("chats-section")).toBeVisible();
	await expect(page.getByTestId("chats-empty")).toBeVisible();

	await page.getByTestId("welcome-action").filter({ hasText: "Chat without a project" }).click();

	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	await expect(page.getByTestId("scope-project-name")).toHaveText("Chats");
	await expect(page.getByTestId("scope-name")).toHaveText("Chat");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const row = page.getByTestId("chat-item");
	await expect(row).toHaveCount(1);
	await expect(row).toHaveAttribute("data-active", "true");

	const stored = storedChats();
	expect(stored.container?.kind).toBe("chats");
	expect(stored.chats).toHaveLength(1);
	expect(stored.chats[0]).toMatchObject({ kind: "chat", branch: "", baseBranch: "" });
	expect(chatFolders()).toHaveLength(1);
	expect(stored.chats[0]?.worktreePath.endsWith(chatFolders()[0] ?? "?")).toBe(true);
	expect(
		existsSync(join(E2E_DATA_DIR, "workspaces.json"))
			? (JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[])
			: [],
	).toEqual([]);

	await revealWorkbenchTool(page, "specs");
	await expect(page.locator('[data-testid="chat-tool-unavailable"]:visible').first()).toBeVisible();
	await revealWorkbenchTool(page, "files");
	await expect(page.getByTestId("files-mode-all")).toBeVisible();
	await expect(page.getByTestId("files-mode-changed")).toHaveCount(0);
});

test("a double click starts one chat, and a topbar Delete confirmation closes when another window deletes its chat", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openAppFresh(page);
	await page.getByTestId("welcome-action").filter({ hasText: "Chat without a project" }).dblclick();
	await expect(page.getByTestId("chat-item")).toHaveCount(1);
	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	expect(frames.filter((frame) => frame.method === "chat.create")).toHaveLength(1);

	const [first] = storedChats().chats;
	if (!first) throw new Error("the first chat is not stored");
	await page.getByTestId("add-chat").click();
	await expect(page.getByTestId("chat-item")).toHaveCount(2);
	await expect
		.poll(() =>
			storedChats().chats.some((chat) => chat.id !== first.id && page.url().includes(chat.id)),
		)
		.toBe(true);
	const second = storedChats().chats.find((chat) => chat.id !== first.id);
	if (!second) throw new Error("the second chat is not stored");
	await page.getByTestId("scope-workspace").click();
	await page.getByTestId("scope-chat-delete").click();
	const confirm = page.getByTestId("confirm-delete-chat");
	await expect(confirm).toBeVisible();

	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("chat.delete", { workspaceId: second.id });
	} finally {
		wire.close();
	}
	await expect(page.getByTestId("chat-item")).toHaveCount(1);
	await expect(confirm).toHaveCount(0);
	expect(storedChats().chats.map((chat) => chat.id)).toEqual([first.id]);
	expect(frames.filter((frame) => frame.method === "chat.delete")).toHaveLength(0);
});

test("a Create dialog opened before any repository takes one another window opens when a repository target is chosen", async ({
	page,
}) => {
	const frames: (ClientFrame & { params?: { projectId?: string } })[] = [];
	await observeClientFrames(page, frames);
	await openAppFresh(page);
	await expect(page.getByTestId("welcome")).toBeVisible();
	await pressPlatformShortcut(page, "n");
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("ws-target-worktree")).toHaveCount(0);
	await dialog.getByTestId("ws-prompt").fill("Keep this draft");

	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	let repository: { id: string };
	try {
		repository = await wire.request("project.open", { path: E2E_FIXTURE_REPO });
	} finally {
		wire.close();
	}
	await dialog.getByTestId("ws-target-worktree").click();
	await expect(dialog.getByTestId("ws-project-picker")).toBeVisible();
	await expect
		.poll(() =>
			frames
				.filter((frame) => frame.method === "git.listBranches")
				.map((frame) => frame.params?.projectId),
		)
		.toContain(repository.id);
	expect(
		frames.filter(
			(frame) => frame.method === "git.listBranches" && frame.params?.projectId !== repository.id,
		),
	).toEqual([]);
	await expect(dialog.getByTestId("ws-prompt")).toHaveValue("Keep this draft");
	await page.keyboard.press("Escape");
});

test("from the palette, typed text starts a chat without a project through the dialog; deleting it trashes the folder", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openFixtureProject(page);

	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("search-palette")).toBeVisible();
	await page.getByTestId("search-input").fill("Draft the release notes");
	await pressPlatformShortcut(page, "Enter");
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("ws-prompt")).toHaveValue("Draft the release notes");
	await dialog.getByTestId("ws-target-chat").click();
	await expect(dialog.getByTestId("ws-project-picker")).toHaveCount(0);
	await expect(dialog.getByTestId("ws-branch-picker")).toHaveCount(0);
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();

	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	await expect(
		page.locator('[data-testid="chat-message"][data-role="user"]', {
			hasText: "Draft the release notes",
		}),
	).toBeVisible();
	await expect.poll(() => frames.some((frame) => frame.method === "session.prompt")).toBe(true);
	expect(frames.find((frame) => frame.method === "session.prompt")?.params?.text).toBe(
		"Draft the release notes",
	);
	const [chat] = storedChats().chats;
	if (!chat) throw new Error("the chat was not persisted");
	expect(existsSync(chat.worktreePath)).toBe(true);

	const row = page.getByTestId("chat-item");
	await expect(row).toHaveCount(1);
	await row.getByTestId("chat-menu").click();
	await page.getByTestId("chat-delete").click();
	const confirm = page.getByTestId("confirm-dialog");
	await expect(confirm).toContainText("move to the Trash");
	await confirm.getByTestId("confirm-delete-chat").click();

	await expect(row).toHaveCount(0);
	await expect(page.getByTestId("chats-empty")).toBeVisible();
	await expect.poll(() => existsSync(chat.worktreePath)).toBe(false);
	expect(storedChats().chats).toEqual([]);
	await expect(page.getByTestId("scope-context")).not.toHaveAttribute("data-context", "chat");
});

test("Continue in workspace asks the chat's agent for a summary and shows the operation's phases in the chat", async ({
	page,
}) => {
	await openFixtureProject(page);
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const { workspace, sessionId } = await wire.request("chat.create", {});
		await wire.request("session.dispose", { sessionId });
		seedWorkspaceSession(workspace.worktreePath, {
			id: sessionId,
			messages: [
				{ role: "user", text: "Remember: the answer is 42.", timestamp: Date.now() - 2_000 },
				{ role: "assistant", text: "Noted: 42.", timestamp: Date.now() - 1_000 },
			],
		});
	} finally {
		wire.close();
	}
	await page.getByTestId("chat-item").click();
	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(1);

	const row = page.getByTestId("chat-item");
	await row.getByTestId("chat-menu").click();
	await page.getByTestId("chat-continue").click();
	const dialog = page.getByTestId("continue-chat-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("continue-chat-project")).toContainText("sample-project");
	await dialog.getByTestId("continue-chat-confirm").click();
	await expect(dialog).toBeHidden();

	const card = page.getByTestId("continuation-card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	await expect(card).toContainText("Continue in workspace — sample-project");
	await expect(card).toHaveAttribute("data-phase", "failed", { timeout: 30_000 });
	await expect(card.getByTestId("continuation-status")).toContainText("without a summary");
	await expect(card.getByTestId("continuation-retry")).toBeVisible();
	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	expect(storedChats().chats[0]?.continuedTo).toBeUndefined();
});

test("a topbar Continue dialog closes when another window deletes its chat and this one moves to a sibling", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByTestId("add-chat").click();
	await expect(page.getByTestId("chat-item")).toHaveCount(1);
	const [first] = storedChats().chats;
	if (!first) throw new Error("the first chat is not stored");
	await page.getByTestId("add-chat").click();
	await expect(page.getByTestId("chat-item")).toHaveCount(2);
	await expect
		.poll(() =>
			storedChats().chats.some((chat) => chat.id !== first.id && page.url().includes(chat.id)),
		)
		.toBe(true);
	const second = storedChats().chats.find((chat) => chat.id !== first.id);
	if (!second) throw new Error("the second chat is not stored");

	await page.getByTestId("scope-workspace").click();
	await page.getByTestId("scope-chat-continue").click();
	const dialog = page.getByTestId("continue-chat-dialog");
	await expect(dialog).toBeVisible();
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("chat.delete", { workspaceId: second.id });
	} finally {
		wire.close();
	}
	await expect(page.getByTestId("chat-item")).toHaveCount(1);
	await expect.poll(() => page.url().includes(first.id)).toBe(true);
	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	await expect(dialog).toHaveCount(0);
});
