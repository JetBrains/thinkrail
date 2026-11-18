import { realpathSync } from "node:fs";
import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import type { ExtUiRequest, SessionStateRecord } from "@thinkrail/contracts";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { moveMouseToChatViewport, waitForScrollStability } from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { toolCallReplay } from "./fixtures/streamReplay";

const BASE_TS = 1_700_950_000_000;
const MCP_CALL = "call-linear";

type DialogRequest = Extract<ExtUiRequest, { kind: "select" | "confirm" | "input" | "editor" }>;

interface Wire {
	ask(request: DialogRequest): void;
	askAfter(frames: string[], request: DialogRequest): void;
	dismiss(request: DialogRequest): void;
	replies: { id: string; value: unknown }[];
}

// The host never raised these dialogs, so its own `session.state` pushes would report no pending input
// and the client would drop them; the shim keeps reporting each one until it is answered or dismissed.
async function routeWire(page: Page): Promise<Wire> {
	let browser: WebSocketRoute | null = null;
	const replies: Wire["replies"] = [];
	const asking = new Map<string, DialogRequest>();
	const withDialog = (record: SessionStateRecord): SessionStateRecord => {
		const request = asking.get(record.sessionId);
		return request
			? {
					...record,
					state: {
						...record.state,
						needsInput: { interactionId: request.id, kind: "dialog", request },
					},
				}
			: record;
	};
	const send = (frame: unknown) => {
		if (!browser) throw new Error("the app has not connected yet");
		browser.send(JSON.stringify(frame));
	};
	await page.routeWebSocket(/\/ws(\?|$)/, (route) => {
		browser = route;
		const server = route.connectToServer();
		route.onMessage((message) => {
			try {
				const frame = JSON.parse(message.toString()) as {
					method?: string;
					params?: { response?: { id: string; value: unknown } };
				};
				const response = frame.params?.response;
				if (frame.method === "session.extUiReply" && response) {
					replies.push(response);
					for (const [sessionId, request] of asking) {
						if (request.id === response.id) asking.delete(sessionId);
					}
				}
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => {
			try {
				const frame = JSON.parse(message.toString()) as { channel?: string; data?: unknown };
				if (frame.channel === "session.state" && frame.data) {
					route.send(
						JSON.stringify({ ...frame, data: withDialog(frame.data as SessionStateRecord) }),
					);
					return;
				}
			} catch {}
			route.send(message);
		});
	});
	const ask = (request: DialogRequest) => {
		asking.set(request.sessionId, request);
		send({ channel: "pi.extensionUi", data: request });
	};
	return {
		ask,
		askAfter(frames, request) {
			if (!browser) throw new Error("the app has not connected yet");
			for (const frame of frames) browser.send(frame);
			ask(request);
		},
		dismiss(request) {
			asking.delete(request.sessionId);
			send({
				channel: "pi.extensionUi",
				data: { id: request.id, sessionId: request.sessionId, kind: "dismiss" },
			});
		},
		replies,
	};
}

type SeedMessages = Parameters<typeof seedWorkspaceSession>[1]["messages"];

const TALL_EARLIER_TURN: SeedMessages = [
	{ role: "user", text: "Explain the login flow.", timestamp: BASE_TS - 2_000 },
	{
		role: "assistant",
		text: Array.from({ length: 16 }, (_, step) => `Step ${step + 1} of the login flow.`).join(
			"\n\n",
		),
		timestamp: BASE_TS - 1_000,
	},
];

const LONG_EARLIER_TURNS: SeedMessages = Array.from({ length: 6 }, (_, turn) => [
	{
		role: "user" as const,
		text: `Question ${turn + 1} about the login flow.`,
		timestamp: BASE_TS - 100_000 + turn * 2_000,
	},
	{
		role: "assistant" as const,
		text: Array.from(
			{ length: 16 },
			(_, step) => `Turn ${turn + 1} step ${step + 1} of the login flow.`,
		).join("\n\n"),
		timestamp: BASE_TS - 100_000 + turn * 2_000 + 1_000,
	},
]).flat();

const MCP_CALL_ANSWERED: SeedMessages = [
	{
		role: "toolResult",
		toolCallId: MCP_CALL,
		toolName: "mcp__linear__create_issue",
		content: [{ type: "text", text: "Created ENG-1" }],
		details: {},
		isError: false,
		timestamp: BASE_TS + 3_000,
	},
	{ role: "assistant", text: "Filed it as ENG-1.", timestamp: BASE_TS + 4_000 },
];

async function openSeededChat(
	page: Page,
	name: string,
	earlier: SeedMessages = [],
	later: SeedMessages = [],
): Promise<string> {
	await openFixtureProject(page);
	const { id } = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [
			...earlier,
			{ role: "user", text: "File the issue.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "call-read", name: "read", arguments: { path: "README.md" } },
					{
						type: "toolCall",
						id: MCP_CALL,
						name: "mcp__linear__create_issue",
						arguments: { title: "Fix login", team: "ENG" },
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "call-read",
				toolName: "read",
				content: [{ type: "text", text: "# Fixture" }],
				details: {},
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
			...later,
		],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, name);
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="chat"][data-active="true"]'),
	).toHaveAttribute("data-session-id", id);
	await expect(page.getByTestId("activity-group").first()).toBeVisible();
	return id;
}

test("an extension dialog about a tool call asks on that tool's card, out of a collapsed Activity fold", async ({
	page,
}) => {
	const wire = await routeWire(page);
	const sessionId = await openSeededChat(page, "Dialog on a tool card");
	const group = page.getByTestId("activity-group").first();
	await expect(group).toHaveAttribute("data-expanded", "false");

	wire.ask({
		id: "extui-mcp",
		sessionId,
		kind: "select",
		title: "Allow linear/create_issue? It may change data.",
		options: ["Deny", "Allow once", "Allow in this chat", "Always allow"],
		toolCallId: MCP_CALL,
	});
	const awaiting = group.getByTestId("activity-awaiting-step");
	await expect(awaiting.getByTestId("activity-step")).toHaveAttribute(
		"data-tool",
		"mcp__linear__create_issue",
	);
	const prompt = awaiting.getByTestId("ext-ui-prompt");
	await expect(prompt).toContainText("Allow linear/create_issue? It may change data.");
	await expect(prompt.getByTestId("ext-ui-option")).toHaveText([
		"Deny",
		"Allow once",
		"Allow in this chat",
		"Always allow",
	]);
	await expect(group).toHaveAttribute("data-expanded", "false");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByTestId("ext-ui-announcement")).toHaveText(
		"Your input is needed: Allow linear/create_issue? It may change data.",
	);
	await expect(
		page.getByRole("region", { name: "Allow linear/create_issue? It may change data." }),
	).toBeVisible();
	await expect(prompt.getByTestId("ext-ui-hint")).toHaveText(
		"Sending a chat message cancels this request.",
	);
	await shot(group, "extension-dialogs", "mcp-approval-on-card");

	await prompt.getByTestId("ext-ui-option").filter({ hasText: "Always allow" }).click();
	await expect.poll(() => wire.replies).toEqual([{ id: "extui-mcp", value: "Always allow" }]);
	await expect(page.getByTestId("ext-ui-prompt")).toHaveCount(0);
	await expect(group.getByTestId("activity-awaiting-step")).toHaveCount(0);
});

test("an approval lists the call's whole input inside the prompt, anchored or docked", async ({
	page,
}) => {
	const wire = await routeWire(page);
	const sessionId = await openSeededChat(page, "Approval lists the input");
	const group = page.getByTestId("activity-group").first();
	const topic = "A very long research topic, written out in full detail. ".repeat(60).trim();

	wire.ask({
		id: "extui-anchored",
		sessionId,
		kind: "select",
		title: "Allow linear/create_issue? It may change data.",
		options: ["Deny", "Allow once"],
		toolCallId: MCP_CALL,
		toolInput: { title: "Fix login", topic, team: "ENG" },
	});
	const step = group.getByTestId("activity-awaiting-step").getByTestId("activity-step");
	const prompt = step.getByTestId("ext-ui-prompt");
	const input = prompt.getByTestId("ext-ui-tool-input");
	await expect(input.locator("dt")).toHaveText(["title", "topic", "team"]);
	await expect(input.locator("dd")).toHaveText(["Fix login", topic, "ENG"]);
	await expect(step).toHaveAttribute("data-expanded", "false");
	const bounded = await input.evaluate((list) => ({
		scrolls: list.scrollHeight > list.clientHeight,
		bound: list.clientHeight <= window.innerHeight * 0.4 + 1,
	}));
	expect(bounded).toEqual({ scrolls: true, bound: true });
	await input.evaluate((list) => {
		list.scrollTop = list.scrollHeight;
	});
	await expect(input.locator("dd").last()).toBeInViewport();
	await shot(group, "extension-dialogs", "mcp-approval-lists-input");
	await prompt.getByTestId("ext-ui-option").filter({ hasText: "Deny" }).click();
	await expect.poll(() => wire.replies).toEqual([{ id: "extui-anchored", value: "Deny" }]);

	wire.ask({
		id: "extui-docked",
		sessionId,
		kind: "select",
		title: "Allow linear/create_issue? It may change data.",
		options: ["Deny", "Allow once"],
		toolCallId: `${MCP_CALL}/1`,
		toolInput: { path: "/etc/hosts", force: true },
	});
	const docked = page.getByTestId("ext-ui-prompt");
	await expect(group.getByTestId("ext-ui-prompt")).toHaveCount(0);
	await expect(docked.getByTestId("ext-ui-tool-input").locator("dd")).toHaveText([
		"/etc/hosts",
		"true",
	]);
});

test("a draft typed into an anchored prompt survives folding its Activity group open and shut", async ({
	page,
}) => {
	const wire = await routeWire(page);
	const sessionId = await openSeededChat(page, "Dialog draft across folds");
	const group = page.getByTestId("activity-group").first();
	wire.ask({
		id: "extui-edit",
		sessionId,
		kind: "editor",
		title: "Edit the issue body",
		prefill: "original prefill",
		toolCallId: MCP_CALL,
	});
	const editor = page.getByTestId("ext-ui-editor");
	await expect(editor).toHaveValue("original prefill");
	await editor.fill("user changed draft");
	await group.getByTestId("activity-group-toggle").click();
	await expect(group).toHaveAttribute("data-expanded", "true");
	await expect(editor).toHaveValue("user changed draft");
	await shot(group, "extension-dialogs", "editor-on-expanded-step");
	await group.getByTestId("activity-group-toggle").click();
	await expect(group).toHaveAttribute("data-expanded", "false");
	await expect(editor).toHaveValue("user changed draft");
	await page.getByTestId("ext-ui-submit").click();
	await expect
		.poll(() => wire.replies)
		.toEqual([{ id: "extui-edit", value: "user changed draft" }]);
});

test("each input or editor dialog starts from its own prefill, not from text typed into an earlier one", async ({
	page,
}) => {
	const wire = await routeWire(page);
	const sessionId = await openSeededChat(page, "Dialog drafts per request");
	const prompt = page.getByTestId("ext-ui-prompt");
	const nameRequest: DialogRequest = {
		id: "extui-name",
		sessionId,
		kind: "input",
		title: "Step 1: type a name",
	};

	wire.ask(nameRequest);
	await prompt.getByTestId("ext-ui-input").fill("typed-into-input");
	await prompt.getByTestId("ext-ui-submit").click();
	await expect.poll(() => wire.replies).toEqual([{ id: "extui-name", value: "typed-into-input" }]);

	wire.ask({
		id: "extui-template",
		sessionId,
		kind: "editor",
		title: "Step 2: edit the template",
		prefill: "PREFILL FROM EXTENSION",
	});
	await expect(prompt.getByTestId("ext-ui-editor")).toHaveValue("PREFILL FROM EXTENSION");
	await prompt.getByTestId("ext-ui-submit").click();
	await expect
		.poll(() => wire.replies.at(-1))
		.toEqual({ id: "extui-template", value: "PREFILL FROM EXTENSION" });

	wire.ask(nameRequest);
	await expect(prompt.getByTestId("ext-ui-input")).toHaveValue("");
});

test("every dialog about a tool call scrolls its card into view, not only the first one", async ({
	page,
}) => {
	const wire = await routeWire(page);
	const sessionId = await openSeededChat(page, "Anchored dialogs reveal", TALL_EARLIER_TURN);
	const chatScroll = page.getByTestId("chat-scroll");
	const group = page.getByTestId("activity-group").first();
	const prompt = page.getByTestId("ext-ui-prompt");

	for (const id of ["extui-first", "extui-second"]) {
		await moveMouseToChatViewport(page, chatScroll);
		await page.mouse.wheel(0, -2_000);
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		await waitForScrollStability(chatScroll);
		await expect(group).not.toBeInViewport();
		wire.ask({
			id,
			sessionId,
			kind: "confirm",
			title: "Allow linear/create_issue? It may change data.",
			message: "Sure?",
			toolCallId: MCP_CALL,
		});
		await expect(group.getByTestId("ext-ui-prompt"), id).toBeInViewport();
		await prompt.getByTestId("ext-ui-submit").click();
		await expect(prompt).toHaveCount(0);
	}
	expect(wire.replies).toEqual([
		{ id: "extui-first", value: true },
		{ id: "extui-second", value: true },
	]);
});

test("a dialog that arrives together with its new tool row scrolls that row's card into view", async ({
	page,
}) => {
	const wire = await routeWire(page);
	const sessionId = await openSeededChat(
		page,
		"Tool row and dialog together",
		TALL_EARLIER_TURN,
		MCP_CALL_ANSWERED,
	);
	const chatScroll = page.getByTestId("chat-scroll");
	await waitForScrollStability(chatScroll);
	await moveMouseToChatViewport(page, chatScroll);
	await page.mouse.wheel(0, -200);
	await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
	await waitForScrollStability(chatScroll);

	const toolCall = {
		type: "toolCall",
		id: "call-logout",
		name: "mcp__linear__create_issue",
		arguments: { title: "Fix logout", team: "ENG" },
	} as const;
	wire.askAfter(toolCallReplay(sessionId, toolCall, BASE_TS + 50_000), {
		id: "extui-with-row",
		sessionId,
		kind: "confirm",
		title: "Allow linear/create_issue? It may change data.",
		message: "Sure?",
		toolCallId: toolCall.id,
	});
	await expect(
		page.locator(`[data-testid="ext-ui-prompt"][data-tool-call-id="${toolCall.id}"]`),
	).toBeInViewport();
});

test("an anchored dialog whose card is virtualized away when it arrives does not reveal itself later", async ({
	page,
}) => {
	const wire = await routeWire(page);
	const sessionId = await openSeededChat(
		page,
		"Anchored dialog arrives far away",
		LONG_EARLIER_TURNS,
	);
	const chatScroll = page.getByTestId("chat-scroll");
	const prompt = page.getByTestId("ext-ui-prompt");

	await moveMouseToChatViewport(page, chatScroll);
	await page.mouse.wheel(0, -20_000);
	await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
	await waitForScrollStability(chatScroll);
	await expect(page.getByTestId("activity-group")).toHaveCount(0);
	wire.ask({
		id: "extui-far",
		sessionId,
		kind: "confirm",
		title: "Allow linear/create_issue? It may change data.",
		message: "Sure?",
		toolCallId: MCP_CALL,
	});
	await expect(page.getByTestId("ext-ui-announcement")).toHaveText(
		"Your input is needed: Allow linear/create_issue? It may change data.",
	);

	for (let step = 0; step < 40 && (await prompt.count()) === 0; step += 1) {
		await page.mouse.wheel(0, 300);
		await waitForScrollStability(chatScroll);
	}
	await expect(prompt).toHaveCount(1);
	await waitForScrollStability(chatScroll);
	await expect(prompt).not.toBeInViewport();
});

test("a dialog tied to no tool call docks above the composer, and a host dismissal clears it", async ({
	page,
}) => {
	const wire = await routeWire(page);
	const sessionId = await openSeededChat(page, "Dialog docked above the composer");

	wire.ask({
		id: "extui-paste",
		sessionId,
		kind: "input",
		title: "Paste the code from the browser",
	});
	const prompt = page.getByTestId("ext-ui-prompt");
	await expect(prompt).toHaveAttribute("data-kind", "input");
	await expect(page.getByTestId("chat-row").getByTestId("ext-ui-prompt")).toHaveCount(0);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toBeEditable();
	await expect(
		page.getByRole("textbox", { name: "Paste the code from the browser" }),
	).toBeVisible();
	await shot(page.getByTestId("chat-scroll"), "extension-dialogs", "docked-input");

	await prompt.getByTestId("ext-ui-input").fill("abc-123");
	await prompt.getByTestId("ext-ui-input").press("Enter");
	await expect.poll(() => wire.replies).toEqual([{ id: "extui-paste", value: "abc-123" }]);
	await expect(prompt).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toBeFocused();
	await page.keyboard.type("next");
	await expect(page.getByTestId("chat-input")).toHaveValue("next");

	const gone: DialogRequest = {
		id: "extui-gone",
		sessionId,
		kind: "confirm",
		title: "Run it?",
		message: "Sure?",
	};
	wire.ask(gone);
	await expect(page.getByTestId("ext-ui-prompt")).toBeVisible();
	await shot(page.getByTestId("ext-ui-prompt"), "extension-dialogs", "docked-confirm");
	wire.dismiss(gone);
	await expect(page.getByTestId("ext-ui-prompt")).toHaveCount(0);
});

test("options stack in one column in a narrow prompt, and a tall docked prompt scrolls inside its bound", async ({
	page,
}) => {
	const wire = await routeWire(page);
	const sessionId = await openSeededChat(page, "Dialog layout limits");
	const chat = page.getByTestId("chat-scroll");

	wire.ask({
		id: "extui-many",
		sessionId,
		kind: "select",
		title: "Which branch should the agent rebase onto?",
		options: Array.from({ length: 25 }, (_, index) => `release/2026.${index + 1}`),
	});
	const dock = page.getByTestId("ext-ui-dock");
	const last = page.getByTestId("ext-ui-option").last();
	await expect(last).toHaveText("release/2026.25");
	const [dockBox, chatBox] = [await dock.boundingBox(), await chat.boundingBox()];
	expect(dockBox && chatBox && dockBox.height <= chatBox.height * 0.6 + 1).toBe(true);
	await last.scrollIntoViewIfNeeded();
	await expect(last).toBeInViewport();
	await expect(page.getByTestId("chat-input")).toBeInViewport();
	await last.click();
	await expect.poll(() => wire.replies).toEqual([{ id: "extui-many", value: "release/2026.25" }]);

	await page.setViewportSize({ width: 390, height: 844 });
	wire.ask({
		id: "extui-narrow",
		sessionId,
		kind: "select",
		title: "Allow linear/create_issue? It may change data.",
		options: ["Deny", "Allow once", "Allow in this chat", "Always allow"],
		toolCallId: MCP_CALL,
	});
	const options = page.getByTestId("ext-ui-option");
	await expect(options).toHaveCount(4);
	const lefts = await options.evaluateAll((nodes) =>
		nodes.map((node) => Math.round(node.getBoundingClientRect().left)),
	);
	expect(new Set(lefts).size).toBe(1);
});
