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
import { E2E_DATA_DIR } from "./fixtures/paths";

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
