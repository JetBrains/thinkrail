import { appendFileSync, readFileSync, realpathSync, utimesSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { DelegationRunDetails, Workspace } from "@thinkrail/contracts";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openChatFromHistory,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedSubagentChildTranscript, seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_900_000_000;
const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);
const agentCards = '[data-testid="tool-card"][data-tool="Agent"]';

function runDetailsFor(
	childSessionId: string,
	status: DelegationRunDetails["status"],
): DelegationRunDetails {
	return {
		childSessionId,
		roleName: "echo",
		task: `Task for ${childSessionId}`,
		status,
		model: "faux/echo-1",
		usage: {
			input: 1200,
			output: 340,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.0042,
			turns: 2,
			contextTokens: 1540,
		},
		durationMs: 5400,
	};
}

type AgentToolFixture = {
	id: string;
	args: Record<string, unknown>;
	resultText: string;
	details: DelegationRunDetails;
};

function appendSubagentTurn(
	path: string,
	sessionId: string,
	tools: AgentToolFixture[],
	completion?: { childSessionId: string; report: string },
): void {
	const assistantId = `${sessionId}-agents`;
	const entries: object[] = [
		{
			type: "message",
			id: assistantId,
			parentId: `${sessionId}-m0`,
			timestamp: new Date(BASE_TS + 1_000).toISOString(),
			message: {
				role: "assistant",
				content: tools.map((tool) => ({
					type: "toolCall",
					id: tool.id,
					name: "Agent",
					arguments: tool.args,
				})),
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
		},
	];
	let parentId = assistantId;
	for (const [index, tool] of tools.entries()) {
		const id = `${sessionId}-result-${index}`;
		entries.push({
			type: "message",
			id,
			parentId,
			timestamp: new Date(BASE_TS + 2_000 + index).toISOString(),
			message: {
				role: "toolResult",
				toolCallId: tool.id,
				toolName: "Agent",
				content: [{ type: "text", text: tool.resultText }],
				details: tool.details,
				isError: false,
				timestamp: BASE_TS + 2_000 + index,
			},
		});
		parentId = id;
	}
	if (completion) {
		const id = `${sessionId}-completion`;
		entries.push({
			type: "custom_message",
			id,
			parentId,
			timestamp: new Date(BASE_TS + 3_000).toISOString(),
			customType: "subagent-completion",
			content: `Subagent "echo" (${completion.childSessionId}) completed:\n\n${completion.report}`,
			display: true,
			details: runDetailsFor(completion.childSessionId, "completed"),
		});
		parentId = id;
	}
	entries.push({
		type: "message",
		id: `${sessionId}-done`,
		parentId,
		timestamp: new Date(BASE_TS + 4_000).toISOString(),
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Delegation work reviewed." }],
			stopReason: "stop",
			timestamp: BASE_TS + 4_000,
		},
	});
	appendFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	utimesSync(path, new Date(BASE_TS), new Date(BASE_TS));
}

function defaultWorkspaceId(): string {
	const workspaces = JSON.parse(
		readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8"),
	) as Workspace[];
	const workspace = workspaces.find((w) => w.kind === "default");
	if (!workspace) throw new Error("default workspace not persisted");
	return workspace.id;
}

function seedChildTranscript(
	workspaceId: string,
	parentSessionId: string,
	childSessionId: string,
	reply: string,
): void {
	seedSubagentChildTranscript(workspaceId, parentSessionId, childSessionId, {
		cwd: repoCwd(),
		messages: [
			{ role: "user", text: `Task for ${childSessionId}`, timestamp: BASE_TS },
			{ role: "assistant", text: reply, timestamp: BASE_TS + 500 },
		],
	});
}

async function expandCard(card: Locator): Promise<Locator> {
	await expect(card).toHaveAttribute("data-expanded", "false");
	await card.getByTestId("tool-card-toggle").click();
	await expect(card).toHaveAttribute("data-expanded", "true");
	const body = card.getByTestId("tool-agent");
	await expect(body).toBeVisible();
	return body;
}

async function expectTranscriptDialogFromDisk(
	page: Page,
	childSessionId: string,
	replyMarker: string,
): Promise<void> {
	const dialog = page.getByTestId("subagent-transcript-dialog");
	await expect(dialog).toBeVisible();
	const transcript = dialog.getByTestId("subagent-transcript");
	await expect(transcript.locator('[data-testid="chat-message"][data-role="user"]')).toContainText(
		`Task for ${childSessionId}`,
	);
	await expect(
		transcript.locator('[data-testid="chat-message"][data-role="assistant"]').last(),
	).toContainText(replyMarker);
	await expect(dialog.getByTestId("subagent-stop")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
}

test("hydrated Agent cards carry three-state outcomes, the completion turn renders, and the transcript dialog reads the child session from disk", async ({
	page,
}) => {
	await openFixtureProject(page);
	const chat = seedWorkspaceSession(repoCwd(), {
		name: "subagent outcomes",
		messages: [{ role: "user", text: "delegate the follow-ups", timestamp: BASE_TS }],
	});
	appendSubagentTurn(
		chat.path,
		chat.id,
		[
			{
				id: "agent-done",
				args: { subagent_type: "echo", task: "Task for child-fg-done" },
				resultText: "FG-DONE-REPORT: everything landed.",
				details: runDetailsFor("child-fg-done", "completed"),
			},
			{
				id: "agent-aborted",
				args: { subagent_type: "echo", task: "Task for child-fg-aborted" },
				resultText: "Run aborted before a final report.",
				details: runDetailsFor("child-fg-aborted", "aborted"),
			},
		],
		{ childSessionId: "child-bg-finished", report: "BG-DONE-REPORT: background result." },
	);

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await openChatFromHistory(page, "subagent outcomes");
	const workspaceId = defaultWorkspaceId();
	seedChildTranscript(workspaceId, chat.id, "child-fg-done", "FG-CHILD-TRANSCRIPT reply");
	seedChildTranscript(workspaceId, chat.id, "child-bg-finished", "BG-CHILD-TRANSCRIPT reply");

	const cards = page.locator(agentCards);
	await expect(cards).toHaveCount(2);
	const done = cards.first();
	const aborted = cards.nth(1);
	await expect(done).toHaveAttribute("data-status", "done");
	await expect(done).toHaveAttribute("data-outcome", "success");
	await expect(aborted).toHaveAttribute("data-status", "done");
	await expect(aborted).toHaveAttribute("data-outcome", "warning");

	const completion = page.getByTestId("subagent-completion");
	await expect(completion).toBeVisible();
	await expect(completion).toHaveAttribute("data-status", "completed");
	await completion.getByTestId("subagent-completion-report-toggle").click();
	await expect(completion.getByTestId("subagent-completion-report")).toContainText(
		"BG-DONE-REPORT",
	);
	await completion.getByTestId("subagent-completion-transcript").click();
	await expectTranscriptDialogFromDisk(page, "child-bg-finished", "BG-CHILD-TRANSCRIPT");

	const doneBody = await expandCard(done);
	await expect(doneBody).toHaveAttribute("data-status", "completed");
	await doneBody.getByTestId("agent-report-toggle").click();
	await expect(doneBody.getByTestId("agent-report")).toContainText("FG-DONE-REPORT");
	await doneBody.getByTestId("agent-open-transcript").click();
	await expectTranscriptDialogFromDisk(page, "child-fg-done", "FG-CHILD-TRANSCRIPT");
	await done.getByTestId("tool-card-toggle").click();
	await expect(done).toHaveAttribute("data-expanded", "false");

	const abortedBody = await expandCard(aborted);
	await expect(abortedBody).toHaveAttribute("data-status", "aborted");
	await expect(abortedBody.getByTestId("agent-background-ack")).toHaveCount(0);
});

test("a hydrated background ack with no registry entry reconciles to the lost state and keeps the disk transcript", async ({
	page,
}) => {
	await openFixtureProject(page);
	const chat = seedWorkspaceSession(repoCwd(), {
		name: "background subagent",
		messages: [{ role: "user", text: "run the sweep in the background", timestamp: BASE_TS }],
	});
	appendSubagentTurn(chat.path, chat.id, [
		{
			id: "agent-bg",
			args: { subagent_type: "echo", task: "Task for child-bg", run_in_background: true },
			resultText: "Started echo in the background: child-bg",
			details: runDetailsFor("child-bg", "running"),
		},
	]);

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await openChatFromHistory(page, "background subagent");
	seedChildTranscript(defaultWorkspaceId(), chat.id, "child-bg", "BG-LIVE-TRANSCRIPT reply");

	const card = page.locator(agentCards).first();
	await expect(card).toHaveAttribute("data-status", "done");
	await expect(card).toHaveAttribute("data-outcome", "success");

	const body = await expandCard(card);
	await expect(body).toHaveAttribute("data-status", "running");
	await expect(body.getByTestId("agent-background-ack")).toHaveAttribute("data-status", "lost");

	await body.getByTestId("agent-open-transcript").click();
	await expectTranscriptDialogFromDisk(page, "child-bg", "BG-LIVE-TRANSCRIPT");
});
