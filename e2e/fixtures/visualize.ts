import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import type { ToolCall } from "@thinkrail/contracts";
import {
	enterDefaultWorkspace,
	expandDisclosure,
	openFixtureProject,
	openPersistedChat,
} from "./app";
import { E2E_FIXTURE_REPO } from "./paths";
import { seedWorkspaceSession } from "./sessions";

const BASE_TS = 1_700_920_000_000;
export async function openVisualization(
	page: Page,
	name: string,
	args: ToolCall["arguments"],
	assistantText?: string,
): Promise<Locator> {
	return (await openVisualizationSession(page, name, args, assistantText)).card;
}

export async function openVisualizationSession(
	page: Page,
	name: string,
	args: ToolCall["arguments"],
	assistantText?: string,
): Promise<{ card: Locator; sessionId: string }> {
	await openFixtureProject(page);
	const messages: Parameters<typeof seedWorkspaceSession>[1]["messages"] = [
		{ role: "user", text: "Show the visualization.", timestamp: BASE_TS },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "visualize-1", name: "visualize", arguments: args }],
			stopReason: "toolUse",
			timestamp: BASE_TS + 1_000,
		},
		{
			role: "toolResult",
			toolCallId: "visualize-1",
			toolName: "visualize",
			content: [{ type: "text", text: "Visualization complete." }],
			details: args,
			isError: false,
			timestamp: BASE_TS + 2_000,
		},
	];
	if (assistantText !== undefined) {
		messages.push({
			role: "assistant",
			text: assistantText,
			stopReason: "stop",
			timestamp: BASE_TS + 3_000,
		});
	}
	const { id: sessionId } = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages,
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, name);
	const card = page.locator('[data-testid="tool-card"][data-tool="visualize"]');
	await expect(card).toHaveCount(1);
	await expect(card).toBeVisible();
	await expect(card).toHaveAttribute("data-status", "done");
	await expect(card).toHaveAttribute("data-expanded", "true");
	await expect(card.getByTestId("tool-visualize")).toHaveAttribute("data-status", "done");
	return { card, sessionId };
}

export const MOCKUP_DIR = ".thinkrail/context/mockups";

export function writeMockups(files: Record<string, string>): () => void {
	const dir = join(E2E_FIXTURE_REPO, MOCKUP_DIR);
	mkdirSync(dir, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, name)), { recursive: true });
		writeFileSync(join(dir, name), content);
	}
	return () => rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
}

export const mockupHtml = (label: string) =>
	`<!doctype html><html><body><main><h1>Settings</h1><span class="cta">${label}</span></main></body></html>`;

export async function openAppearance(page: Page): Promise<Locator> {
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-appearance").click();
	await expect(dialog).toContainText("Theme");
	// The fixed-mode theme list sits in a collapsed disclosure.
	await expandDisclosure(dialog.getByTestId("theme-toggle"));
	return dialog;
}

export async function pickTheme(page: Page, id: string): Promise<void> {
	const dialog = await openAppearance(page);
	await dialog.locator(`[data-theme-id="${id}"]`).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", id);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
}

export async function nodeColors(node: Locator): Promise<{ actual: string; expected: string }> {
	return node.evaluate((element) => {
		const probe = document.createElement("div");
		probe.style.backgroundColor = "var(--container-elevated-bg)";
		document.body.append(probe);
		const expected = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return { actual: getComputedStyle(element).fill, expected };
	});
}
