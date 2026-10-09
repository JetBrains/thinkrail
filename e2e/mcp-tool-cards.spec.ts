import { randomUUID } from "node:crypto";
import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	expandAllRoutineGroups,
	openFixtureProject,
	openPersistedChat,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_940_000_000;
const PIXEL =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const SIGN_IN_TEXT = 'MCP server "linear" requires sign-in. Run /mcp to sign in.';

interface SeededCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
	content: Array<
		{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
	>;
	details: unknown;
	isError?: boolean;
}

async function openSeededCalls(page: Page, name: string, calls: SeededCall[]): Promise<void> {
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [
			{ role: "user", text: "Use the MCP servers.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: calls.map((call) => ({
					type: "toolCall" as const,
					id: call.id,
					name: call.name,
					arguments: call.args,
				})),
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			...calls.map((call, index) => ({
				role: "toolResult" as const,
				toolCallId: call.id,
				toolName: call.name,
				content: call.content,
				details: call.details,
				isError: call.isError ?? false,
				timestamp: BASE_TS + 2_000 + index,
			})),
		],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, name);
	await expect(page.getByTestId("activity-group")).toHaveAttribute("data-expanded", "false");
	await expandAllRoutineGroups(page);
}

async function expandStep(page: Page, toolCallId: string): Promise<Locator> {
	const step = page.locator(`[data-testid="activity-step"][data-activity-node-id="${toolCallId}"]`);
	await expect(step).toBeVisible();
	await step.getByTestId("activity-step-toggle").click();
	await expect(step).toHaveAttribute("data-expanded", "true");
	return step;
}

function truncatedPreview(path: string): string {
	return `Warning: truncated output (original token count: 7500)\nTotal output lines: 2001\n\nline of output\nline of output\n…29970 chars truncated…line of output\nEND OF FULL OUTPUT\n\n[Full output: ${path} (read it with offset/limit)]`;
}

test("MCP results render as cards with structured content, Full output and a sign-in action", async ({
	page,
}) => {
	const fullOutput = join(tmpdir(), `thinkrail-e2e-mcp-${randomUUID()}.txt`);
	const expiredOutput = join(tmpdir(), `thinkrail-e2e-mcp-gone-${randomUUID()}.txt`);
	writeFileSync(fullOutput, `${"line of output\n".repeat(2_000)}END OF FULL OUTPUT\n`);
	try {
		await openSeededCalls(page, "MCP cards", [
			{
				id: "mcp-rich",
				name: "mcp__fixture__rich",
				args: { verbose: true },
				content: [
					{ type: "text", text: "rich result" },
					{ type: "image", data: PIXEL, mimeType: "image/png" },
					{ type: "text", text: '[Resource file:///notes/a.md "a.md" (text/markdown)]' },
				],
				details: {
					server: "fixture",
					tool: "rich",
					thinkrail: {
						blocks: [
							{ kind: "text", chars: 11 },
							{ kind: "image", mimeType: "image/png" },
							{
								kind: "resource_link",
								uri: "file:///notes/a.md",
								name: "a.md",
								mimeType: "text/markdown",
							},
						],
						structuredContent: { rows: [{ id: 1, title: "first" }] },
					},
				},
			},
			{
				id: "mcp-big",
				name: "mcp__fixture__big",
				args: {},
				content: [{ type: "text", text: truncatedPreview(fullOutput) }],
				details: {
					server: "fixture",
					tool: "big",
					fullOutputPath: fullOutput,
					thinkrail: { blocks: [{ kind: "text", chars: 30_018 }] },
				},
			},
			{
				id: "mcp-big-expired",
				name: "mcp__fixture__big",
				args: {},
				content: [{ type: "text", text: truncatedPreview(expiredOutput) }],
				details: { server: "fixture", tool: "big", fullOutputPath: expiredOutput },
			},
			{
				id: "mcp-sign-in",
				name: "mcp__linear__search_issues",
				args: { query: "login bug", limit: 5 },
				content: [{ type: "text", text: SIGN_IN_TEXT }],
				details: {},
				isError: true,
			},
		]);

		const rich = await expandStep(page, "mcp-rich");
		const richCard = rich.getByTestId("tool-mcp");
		await expect(richCard).toHaveAttribute("data-server", "fixture");
		await expect(richCard).toHaveAttribute("data-mcp-tool", "rich");
		await expect(richCard.getByTestId("mcp-output")).toContainText("rich result");
		await expect(rich.getByTestId("tool-result-image-thumbnail")).toHaveCount(1);
		await expect(richCard.locator("img")).toHaveCount(0);
		await richCard.getByTestId("mcp-structured-toggle").click();
		await expect(richCard.getByTestId("mcp-json-tree")).toContainText('"first"');
		await shot(rich, "mcp-tool-cards", "rich-structured");

		const big = await expandStep(page, "mcp-big");
		await big.getByTestId("mcp-full-output").click();
		const dialog = page.getByTestId("mcp-full-output-dialog");
		await expect(dialog.getByTestId("mcp-full-output-text")).toContainText("END OF FULL OUTPUT");
		await expect(dialog.getByTestId("mcp-full-output-truncated")).toHaveCount(0);
		await shot(dialog, "mcp-tool-cards", "full-output");
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(big.getByTestId("mcp-full-output")).toBeFocused();
		await shot(big, "mcp-tool-cards", "truncated-result");

		const expired = await expandStep(page, "mcp-big-expired");
		await expired.getByTestId("mcp-full-output").click();
		await expect(dialog.getByTestId("mcp-full-output-unavailable")).toHaveAttribute(
			"data-reason",
			"expired",
		);
		await shot(dialog, "mcp-tool-cards", "full-output-expired");
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		const signIn = await expandStep(page, "mcp-sign-in");
		await expect(signIn).toHaveAttribute("data-status", "error");
		await expect(signIn.getByTestId("tool-mcp")).toHaveAttribute("data-server", "linear");
		await expect(signIn.getByTestId("mcp-output")).toHaveAttribute("data-failed", "true");
		await shot(signIn, "mcp-tool-cards", "sign-in");
		await signIn.getByTestId("mcp-cli-action").click();
		await expect(page.getByTestId("settings-dialog")).toBeVisible();
		await expect(page.getByTestId("settings-mcp")).toBeVisible();
		await expect(page.getByTestId("settings-nav-mcp")).toHaveAttribute("data-active", "true");
	} finally {
		rmSync(fullOutput, { force: true });
	}
});

test("resource listings, resource reads and tool_search render as their own cards", async ({
	page,
}) => {
	const listing = {
		resources: [
			{ server: "docs", uri: "file:///notes/a.md", name: "a.md", mimeType: "text/markdown" },
			{ server: "wiki", uri: "wiki://home", name: "home", title: "Home page" },
		],
		errors: [{ server: "linear", error: SIGN_IN_TEXT }],
	};
	await openSeededCalls(page, "MCP resources", [
		{
			id: "list-all",
			name: "list_mcp_resources",
			args: {},
			content: [{ type: "text", text: JSON.stringify(listing) }],
			details: {
				server: "",
				tool: "list_mcp_resources",
				thinkrail: { blocks: [], structuredContent: listing },
			},
		},
		{
			id: "list-templates-truncated",
			name: "list_mcp_resource_templates",
			args: { server: "docs" },
			content: [
				{
					type: "text",
					text: 'Warning: truncated output (original token count: 9000)\nTotal output lines: 1\n\n{"server":"docs","resourceTemplates":[{"server":"docs"…31000 chars truncated…}]}\n\n[Full output: /tmp/gone.txt (read it with offset/limit)]',
				},
			],
			details: {
				server: "docs",
				tool: "list_mcp_resource_templates",
				thinkrail: { blocks: [], structuredContentTruncated: true },
			},
		},
		{
			id: "read-a",
			name: "read_mcp_resource",
			args: { server: "docs", uri: "file:///notes/a.md" },
			content: [{ type: "text", text: "# Notes\nFirst entry." }],
			details: {
				server: "docs",
				tool: "read_mcp_resource",
				thinkrail: {
					blocks: [
						{ kind: "resource", uri: "file:///notes/a.md", mimeType: "text/markdown", chars: 20 },
					],
				},
			},
		},
		{
			id: "search",
			name: "tool_search",
			args: { query: "notes" },
			content: [
				{
					type: "text",
					text: "Loaded 1 tool. They are available from your next call:\n- mcp__fixture__write_note: Store a note",
				},
			],
			details: { loaded: ["mcp__fixture__write_note"] },
		},
	]);

	const all = await expandStep(page, "list-all");
	await expect(all.getByTestId("mcp-card-header")).toContainText("All servers");
	await expect(all.getByTestId("mcp-listed-item")).toHaveCount(2);
	await expect(all.getByTestId("mcp-listed-server")).toHaveText(["docs", "wiki"]);
	await expect(all.getByTestId("mcp-listing-error").getByTestId("mcp-cli-action")).toHaveText(
		"Sign in",
	);
	await shot(all, "mcp-tool-cards", "list-resources");

	const truncated = await expandStep(page, "list-templates-truncated");
	await expect(truncated.getByTestId("mcp-listing")).toHaveCount(0);
	await expect(truncated.getByTestId("mcp-output")).toContainText("31000 chars truncated");
	await shot(truncated, "mcp-tool-cards", "list-templates-truncated");

	const read = await expandStep(page, "read-a");
	await expect(read.getByTestId("mcp-card-header")).toContainText("file:///notes/a.md");
	await expect(read.getByTestId("mcp-output")).toContainText("First entry.");
	await shot(read, "mcp-tool-cards", "read-resource");

	const search = await expandStep(page, "search");
	await expect(search.getByTestId("tool-search-loaded")).toContainText("mcp__fixture__write_note");
	await expect(search.getByTestId("tool-search-loaded")).toContainText("Store a note");
	await shot(search, "mcp-tool-cards", "tool-search");
});
