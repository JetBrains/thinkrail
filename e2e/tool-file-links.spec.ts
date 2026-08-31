import { appendFileSync, realpathSync, utimesSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openChatFromHistory,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_800_000_000;
const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

type ToolFixture = {
	id: string;
	name: string;
	args: Record<string, unknown>;
	text: string;
	details?: unknown;
};

const TOOLS: ToolFixture[] = [
	{
		id: "read-local",
		name: "read",
		args: { path: "README.md" },
		text: "# sample-project",
	},
	{
		id: "read-external",
		name: "read",
		args: { path: "/tmp/outside.png" },
		text: "/tmp/outside.png\nRead image file [image/png]",
	},
	{
		id: "edit-local",
		name: "edit",
		args: { path: "README.md", oldText: "sample", newText: "sample-project" },
		text: "Updated README.md",
	},
	{
		id: "spec-grep",
		name: "spec_grep",
		args: { pattern: "Responsibility" },
		text: "1 match(es):\nmodule-a/SPEC.md:11: ## Responsibility",
		details: {
			matches: [{ path: "module-a/SPEC.md", line: 11, snippet: "## Responsibility" }],
			truncated: false,
		},
	},
	{
		id: "spec-get",
		name: "spec_get",
		args: { id: "sample-root" },
		text: [
			"sample-root [goal-and-requirements] — Sample Project",
			"path: SPEC.md",
			"links:",
			"  parent -> sample-module (module-a/SPEC.md)",
		].join("\n"),
		details: {
			path: "SPEC.md",
			links: [{ path: "module-a/SPEC.md" }],
			reverseLinks: [],
		},
	},
	{
		id: "spec-create",
		name: "spec_create",
		args: { path: "module-a/SPEC.md", id: "sample-module" },
		text: "Created module-a/SPEC.md (id: sample-module).",
		details: { path: "module-a/SPEC.md", id: "sample-module" },
	},
	{
		id: "spec-delete",
		name: "spec_delete",
		args: { id: "removed" },
		text: "Deleted removed/SPEC.md (id: removed).",
		details: { path: "removed/SPEC.md", id: "removed" },
	},
	{
		id: "fetch-local-video",
		name: "fetch_content",
		args: { url: "/tmp/video.mp4" },
		text: "# Fetched content\n\nRead the [external source](https://example.com/source).",
		details: { urls: ["/tmp/video.mp4"], responseId: "response-123" },
	},
	{
		id: "stored-content",
		name: "get_search_content",
		args: { responseId: "response-123", urlIndex: 0 },
		text: "# Stored content\n\nRecovered the complete document.",
		details: { url: "https://example.com/docs", title: "Stored content" },
	},
];

function appendToolResults(path: string, sessionId: string): void {
	const assistantId = `${sessionId}-tools`;
	const entries: object[] = [
		{
			type: "message",
			id: assistantId,
			parentId: `${sessionId}-m0`,
			timestamp: new Date(BASE_TS + 1_000).toISOString(),
			message: {
				role: "assistant",
				content: TOOLS.map((tool) => ({
					type: "toolCall",
					id: tool.id,
					name: tool.name,
					arguments: tool.args,
				})),
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
		},
	];
	let parentId = assistantId;
	for (const [index, tool] of TOOLS.entries()) {
		const id = `${sessionId}-result-${index}`;
		entries.push({
			type: "message",
			id,
			parentId,
			timestamp: new Date(BASE_TS + 2_000 + index).toISOString(),
			message: {
				role: "toolResult",
				toolCallId: tool.id,
				toolName: tool.name,
				content: [{ type: "text", text: tool.text }],
				details: tool.details,
				isError: false,
				timestamp: BASE_TS + 2_000 + index,
			},
		});
		parentId = id;
	}
	entries.push({
		type: "message",
		id: `${sessionId}-done`,
		parentId,
		timestamp: new Date(BASE_TS + 3_000).toISOString(),
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Finished inspecting the tool outputs." }],
			stopReason: "stop",
			timestamp: BASE_TS + 3_000,
		},
	});
	appendFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	utimesSync(path, new Date(BASE_TS), new Date(BASE_TS));
}

async function toolStep(page: Page, toolName: string, index = 0): Promise<Locator> {
	const activity = page.getByTestId("activity-group").first();
	if ((await activity.getAttribute("data-expanded")) !== "true") {
		await activity.getByTestId("activity-group-toggle").click();
		await expect(activity).toHaveAttribute("data-expanded", "true");
	}
	const step = activity
		.locator(`[data-testid="activity-step"][data-tool="${toolName}"]`)
		.nth(index);
	await expect(step).toBeVisible();
	if ((await step.getAttribute("data-expanded")) !== "true") {
		await step.getByTestId("activity-step-toggle").click();
		await expect(step).toHaveAttribute("data-expanded", "true");
	}
	return step;
}

async function returnToChat(page: Page): Promise<void> {
	await page.locator('[data-testid="editor-tab"][data-kind="chat"]').click();
	await expect(page.getByTestId("chat-view")).toBeVisible();
}

test("structured tool paths reuse the preview tab while rich tool results stay intentional", async ({
	page,
}) => {
	await openFixtureProject(page);
	const chat = seedWorkspaceSession(repoCwd(), {
		name: "tool file links",
		messages: [{ role: "user", text: "inspect structured tool outputs", timestamp: BASE_TS }],
	});
	appendToolResults(chat.path, chat.id);

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await openChatFromHistory(page, "tool file links");

	const localRead = await toolStep(page, "read");
	await localRead.getByTestId("tool-file-link").click();
	const fileTabs = page.locator('[data-testid="editor-tab"][data-kind="file"]');
	await expect(fileTabs).toHaveCount(1);
	await expect(fileTabs.first()).toContainText("README.md");
	await expect(fileTabs.first()).toHaveAttribute("data-preview", "true");

	await returnToChat(page);
	const specGet = await toolStep(page, "spec_get");
	await expect(specGet).not.toContainText('"id"');
	await specGet.getByTestId("tool-file-link").filter({ hasText: "module-a/SPEC.md" }).click();
	await expect(fileTabs).toHaveCount(1);
	await expect(fileTabs.first()).toContainText("SPEC.md");
	await expect(fileTabs.first()).toHaveAttribute("data-preview", "true");

	await returnToChat(page);
	const externalRead = await toolStep(page, "read", 1);
	await expect(externalRead).toContainText("/tmp/outside.png");
	await expect(externalRead.getByTestId("tool-file-link")).toHaveCount(0);

	const edit = await toolStep(page, "edit");
	await expect(edit.getByTestId("tool-file-link")).toHaveText("README.md");

	const specGrep = await toolStep(page, "spec_grep");
	await expect(specGrep.getByTestId("tool-file-link")).toHaveText("module-a/SPEC.md");
	const specCreate = await toolStep(page, "spec_create");
	await expect(specCreate.getByTestId("tool-file-link")).toHaveText("module-a/SPEC.md");
	const specDelete = await toolStep(page, "spec_delete");
	await expect(specDelete).toContainText("removed/SPEC.md");
	await expect(specDelete.getByTestId("tool-file-link")).toHaveCount(0);

	const fetch = await toolStep(page, "fetch_content");
	await expect(fetch).toContainText("/tmp/video.mp4");
	await expect(fetch.getByTestId("tool-file-link")).toHaveCount(0);
	await expect(fetch.getByRole("heading", { name: "Fetched content" })).toBeVisible();
	await expect(fetch.getByRole("link", { name: "external source" })).toHaveAttribute(
		"href",
		"https://example.com/source",
	);

	const stored = await toolStep(page, "get_search_content");
	await expect(stored.getByRole("heading", { name: "Stored content" })).toBeVisible();
	await expect(stored).not.toContainText('"responseId"');
});
