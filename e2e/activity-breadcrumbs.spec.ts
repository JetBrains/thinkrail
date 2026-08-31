import { appendFileSync, realpathSync, utimesSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openChatFromHistory,
	openFixtureProject,
} from "./fixtures/app";
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

test("a model-authored Thinking heading stays bounded and appears only while folded", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 780 });
	await openFixtureProject(page);
	const chat = seedWorkspaceSession(repoCwd(), {
		name: "thinking summary",
		messages: [{ role: "user", text: "Check the formatter output.", timestamp: BASE_TS }],
	});
	const assistantId = `${chat.id}-a1`;
	const toolNames = ["get_search_content", "fetch_content", "web_search", "spec_grep", "read"];
	appendMessage(chat.path, assistantId, `${chat.id}-m0`, {
		role: "assistant",
		content: [
			{
				type: "thinking",
				thinking:
					"**Evaluating formatting process**\n\nI should inspect the formatted file before continuing.",
			},
			...toolNames.map((name, index) => ({
				type: "toolCall",
				id: `summary-tool-${index}`,
				name,
				arguments: {},
			})),
		],
		usage,
		stopReason: "toolUse",
		timestamp: BASE_TS + 1_000,
	});
	let parentId = assistantId;
	for (const [index, toolName] of toolNames.entries()) {
		parentId = appendMessage(chat.path, `${chat.id}-summary-tool-${index}`, parentId, {
			role: "toolResult",
			toolCallId: `summary-tool-${index}`,
			toolName,
			content: [{ type: "text", text: "completed" }],
			isError: false,
			timestamp: BASE_TS + 2_000 + index,
		});
	}
	appendMessage(chat.path, `${chat.id}-a2`, parentId, {
		role: "assistant",
		content: [{ type: "text", text: "The formatter output is consistent." }],
		usage,
		stopReason: "stop",
		timestamp: BASE_TS + 3_000,
	});
	utimesSync(chat.path, new Date(BASE_TS), new Date(BASE_TS));

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await openChatFromHistory(page, "thinking summary");

	const activity = page.getByTestId("activity-group").first();
	await activity.getByTestId("activity-group-toggle").click();
	const thinking = activity.getByTestId("thinking-group").first();
	const toggle = thinking.getByTestId("thinking-group-toggle");
	const heading = thinking.getByTestId("thinking-group-headline");
	const thinkingLabel = toggle.locator("span", { hasText: /^Thinking$/ });
	const metadata = "5 steps · get_search_content, fetch_content, web_search, spec_grep, +1 more";
	await expect(heading).toBeVisible();
	await expect(heading).toHaveText("Evaluating formatting process");
	await expect(heading).toHaveCSS("font-weight", "370");
	await expect(thinkingLabel).toHaveClass(/sr-only/);
	await expect(toggle).toContainText(metadata);

	await page.setViewportSize({ width: 390, height: 780 });
	await thinking.evaluate((element) => {
		element.style.width = "280px";
	});
	const layout = await toggle.evaluate((element, title) => {
		const metadataElement = [...element.querySelectorAll<HTMLElement>("span")].find(
			(candidate) => candidate.title === title,
		);
		const headingElement = element.querySelector<HTMLElement>(
			'[data-testid="thinking-group-headline"]',
		);
		if (!metadataElement || !headingElement)
			throw new Error("missing folded Thinking header parts");
		return {
			buttonClientWidth: element.clientWidth,
			buttonScrollWidth: element.scrollWidth,
			headingClientWidth: headingElement.clientWidth,
			metadataClientWidth: metadataElement.clientWidth,
			metadataScrollWidth: metadataElement.scrollWidth,
		};
	}, metadata);
	expect(layout.headingClientWidth).toBe(0);
	expect(layout.metadataClientWidth).toBeLessThan(layout.metadataScrollWidth);
	expect(layout.buttonScrollWidth).toBeLessThanOrEqual(layout.buttonClientWidth);

	await toggle.click();

	await expect(thinking).toHaveAttribute("data-expanded", "true");
	await expect(thinkingLabel).not.toHaveClass(/sr-only/);
	await expect(heading).toHaveCount(0);
	await expect(thinking.getByTestId("thinking-group-text")).toContainText(
		"**Evaluating formatting process**",
	);
});

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
	await openChatFromHistory(page, "sticky activity");

	const activity = page.getByTestId("activity-group").first();
	await activity.getByTestId("activity-group-toggle").click();
	const thinking = activity.getByTestId("thinking-group").last();
	await thinking.getByTestId("thinking-group-toggle").click();
	const tool = thinking.locator('[data-testid="activity-step"][data-tool="bash"]');
	await tool.getByTestId("activity-step-toggle").click();

	const trail = page.getByTestId("activity-breadcrumb-trail");
	await expect
		.poll(async () => {
			await tool.evaluate((element) => {
				const scroller = element.closest<HTMLElement>('[data-virtuoso-scroller="true"]');
				if (!scroller) throw new Error("missing Virtuoso scroller");
				scroller.scrollTop +=
					element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 80;
			});
			return trail.count();
		})
		.toBe(1);
	await expect(trail).toBeVisible();
	await expect(trail.getByTestId("activity-breadcrumb-segment")).toHaveCount(3);
	await expect(trail.locator('[data-kind="activity"]')).toBeVisible();
	await expect(trail.locator('[data-kind="thinking"]')).toBeVisible();
	await expect(trail.locator('[data-kind="tool"]')).toContainText("bash");

	await trail.getByRole("button", { name: "Jump to Thinking" }).click();
	await expect(thinking.getByTestId("thinking-group-toggle")).toBeFocused();
});
