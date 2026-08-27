import { appendFileSync, realpathSync, utimesSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_400_000_000;
const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);
const usage = {
	input: 10,
	output: 10,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 20,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function appendMessage(path: string, id: string, parentId: string, message: object): string {
	appendFileSync(
		path,
		`${JSON.stringify({
			type: "message",
			id,
			parentId,
			timestamp: new Date(BASE_TS).toISOString(),
			message,
		})}\n`,
	);
	return id;
}

test("sticky activity breadcrumbs expose the off-screen Activity → Thinking → tool path", async ({
	page,
}) => {
	await openFixtureProject(page);
	const chat = seedWorkspaceSession(repoCwd(), {
		name: "sticky activity",
		messages: [
			{ role: "user", text: "Inspect the watcher under sustained churn.", timestamp: BASE_TS },
		],
	});
	const assistantId = `${chat.id}-a1`;
	appendMessage(chat.path, assistantId, `${chat.id}-m0`, {
		role: "assistant",
		content: [
			{ type: "toolCall", id: "read-prefix", name: "read", arguments: { path: "watch.ts" } },
			{ type: "thinking", thinking: "I should inspect the coalescer test next." },
			{ type: "toolCall", id: "read-nested", name: "read", arguments: { path: "watch.test.ts" } },
			{ type: "thinking", thinking: "The failing case needs a bounded max-wait assertion." },
			{
				type: "toolCall",
				id: "bash-long",
				name: "bash",
				arguments: { command: "bun test watch.test.ts" },
			},
		],
		usage,
		stopReason: "toolUse",
		timestamp: BASE_TS + 1_000,
	});
	let parentId = assistantId;
	for (const [toolCallId, toolName, output] of [
		["read-prefix", "read", "watcher source"],
		["read-nested", "read", "coalescer regression"],
		[
			"bash-long",
			"bash",
			Array.from({ length: 120 }, (_, index) => `passing watcher assertion ${index + 1}`).join(
				"\n",
			),
		],
	] as const) {
		parentId = appendMessage(chat.path, `${chat.id}-${toolCallId}`, parentId, {
			role: "toolResult",
			toolCallId,
			toolName,
			content: [{ type: "text", text: output }],
			isError: false,
			timestamp: BASE_TS + 2_000,
		});
	}
	appendMessage(chat.path, `${chat.id}-a2`, parentId, {
		role: "assistant",
		content: [{ type: "text", text: "The watcher now flushes within the bounded window." }],
		usage,
		stopReason: "stop",
		timestamp: BASE_TS + 3_000,
	});
	utimesSync(chat.path, new Date(BASE_TS), new Date(BASE_TS));

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);

	const activity = page.getByTestId("activity-group").first();
	await activity.getByTestId("activity-group-toggle").click();
	const thinking = activity.getByTestId("thinking-group").last();
	await thinking.getByTestId("thinking-group-toggle").click();
	const tool = thinking.locator('[data-testid="activity-step"][data-tool="bash"]');
	await tool.getByTestId("activity-step-toggle").click();

	await tool.evaluate((element) => {
		const scroller = element.closest<HTMLElement>('[data-virtuoso-scroller="true"]');
		if (!scroller) throw new Error("missing Virtuoso scroller");
		scroller.scrollTop +=
			element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 80;
	});

	const trail = page.getByTestId("activity-breadcrumb-trail");
	await expect(trail).toBeVisible();
	await expect(trail.getByTestId("activity-breadcrumb-segment")).toHaveCount(3);
	await expect(trail.locator('[data-kind="activity"]')).toBeVisible();
	await expect(trail.locator('[data-kind="thinking"]')).toBeVisible();
	await expect(trail.locator('[data-kind="tool"]')).toContainText("bash");

	await trail.getByRole("button", { name: "Jump to Thinking" }).click();
	await expect(thinking.getByTestId("thinking-group-toggle")).toBeFocused();
});
