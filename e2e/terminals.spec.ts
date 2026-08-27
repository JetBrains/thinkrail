import { expect, test, type WebSocketRoute } from "@playwright/test";
import {
	activeWorktreeRow,
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	revealFirstProjectWorkspaces,
	runInTerminal,
	visibleTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";

const ESC = "\u001b";
const CURSOR_POSITION_REPLY = new RegExp(`^${ESC}\\[\\d+;\\d+R$`);
const CURSOR_POSITION_QUERY_COMMAND = [
	'python3 -c "import os,select,termios,tty;',
	"old=termios.tcgetattr(0); tty.setraw(0); os.write(1,b'\\x1b[6n');",
	"ready=select.select([0],[],[],2)[0]; reply=os.read(0,64) if ready else b'NO_REPLY';",
	"termios.tcsetattr(0,termios.TCSADRAIN,old); print('TR_DSR_CONSUMED='+repr(reply))\"",
].join(" ");

test("a workspace opens a terminal automatically, rooted in the worktree, with working I/O", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(1);

	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await waitTerminalReady(page);
	const term = visibleTerminalScreen(page);

	await runInTerminal(page, 'basename "$(pwd)"');
	await expect(term).toContainText("workspace-1");

	await runInTerminal(page, "echo TR_MARKER_IO");
	await expect(term).toContainText("TR_MARKER_IO");
});

test("terminals are workspace-scoped and survive workspace switches", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await runInTerminal(page, "echo TR_WS1_BUFFER");
	await expect(visibleTerminalScreen(page)).toContainText("TR_WS1_BUFFER");

	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(2);
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_WS1_BUFFER");

	await worktreeRows(page).nth(0).getByRole("button").first().click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(visibleTerminalScreen(page)).toContainText("TR_WS1_BUFFER");
});

test("multiple terminals per workspace keep independent buffers and can be closed", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await waitTerminalReady(page);
	await runInTerminal(page, "echo TR_ONE");
	await expect(visibleTerminalScreen(page)).toContainText("TR_ONE");

	await openTerminal(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
	await runInTerminal(page, "echo TR_TWO");
	await expect(visibleTerminalScreen(page)).toContainText("TR_TWO");
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_ONE");

	await page.getByTestId("terminal-tab").nth(0).click();
	await expect(visibleTerminalScreen(page)).toContainText("TR_ONE");
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_TWO");

	await page.getByTestId("terminal-tab-close").nth(1).click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await page.getByTestId("terminal-tab-close").click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(0);
	await page.getByTestId("new-terminal").first().click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(
		page.getByTestId("center-group").filter({ has: page.getByTestId("terminal-tab") }),
	).toBeVisible();
	await waitTerminalReady(page);
});

test("the terminal's shell counts characters, not bytes", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const term = visibleTerminalScreen(page);

	await runInTerminal(page, "echo \"LEN=$(printf %s привет | wc -m | tr -d ' ')\"");
	await expect(term).toContainText("LEN=6");

	await runInTerminal(page, 'echo "CHARMAP=$(locale charmap)"');
	await expect(term).toContainText("CHARMAP=UTF-8");
});

test("a shell survives a trip to Project Home and back", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	await runInTerminal(page, "TR_SURVIVOR=alive");
	await runInTerminal(page, 'echo "CHECK=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("CHECK=alive");

	await page.getByTestId("project-item").first().click();
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);

	await worktreeRows(page).nth(0).getByRole("button").first().click();
	await waitTerminalReady(page);
	await expect(visibleTerminalScreen(page)).toContainText("CHECK=alive");

	await runInTerminal(page, 'echo "AGAIN=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("AGAIN=alive");
});

test("historical terminal queries do not become input on remount", async ({ page }) => {
	const writes: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const text = message.toString();
			try {
				const frame = JSON.parse(text) as {
					method?: string;
					params?: { data?: string };
				};
				if (frame.method === "terminal.write" && frame.params?.data) writes.push(frame.params.data);
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	await runInTerminal(page, CURSOR_POSITION_QUERY_COMMAND);
	await expect(visibleTerminalScreen(page)).toContainText("TR_DSR_CONSUMED");
	await expect.poll(() => writes.some((data) => CURSOR_POSITION_REPLY.test(data))).toBe(true);
	writes.length = 0;

	await page.getByTestId("project-item").first().click();
	await worktreeRows(page).first().getByRole("button").first().click();
	await waitTerminalReady(page);
	await expect(visibleTerminalScreen(page)).toContainText("TR_DSR_CONSUMED");
	expect(writes.filter((data) => CURSOR_POSITION_REPLY.test(data))).toEqual([]);

	await runInTerminal(page, CURSOR_POSITION_QUERY_COMMAND);
	await expect.poll(() => writes.some((data) => CURSOR_POSITION_REPLY.test(data))).toBe(true);
});

test("rapid re-entry never spawns a second shell", async ({ page }) => {
	const ptyIds = new Set<string>();
	let delayAttachMs = 0;

	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		const attachIds = new Set<string>();
		ws.onMessage((message) => {
			try {
				const frame = JSON.parse(message.toString()) as { id?: string; method?: string };
				if (frame.method === "terminal.attach" && frame.id) attachIds.add(frame.id);
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => {
			const text = message.toString();
			let frame: { id?: string; channel?: string; data?: { id?: string } } = {};
			try {
				frame = JSON.parse(text) as typeof frame;
			} catch {}
			if (frame.channel === "terminal.data" && frame.data?.id) ptyIds.add(frame.data.id);
			if (frame.id && attachIds.has(frame.id) && delayAttachMs > 0) {
				setTimeout(() => ws.send(text), delayAttachMs);
				return;
			}
			ws.send(message);
		});
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await runInTerminal(page, "TR_SURVIVOR=alive");
	await runInTerminal(page, 'echo "CHECK=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("CHECK=alive");

	delayAttachMs = 3000;
	for (let round = 0; round < 2; round++) {
		await page.getByTestId("project-item").first().click();
		await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
		await worktreeRows(page).nth(0).getByRole("button").first().click();
		await expect(visibleTerminal(page)).toHaveCount(1);
	}
	delayAttachMs = 0;
	await waitTerminalReady(page);

	await runInTerminal(page, 'echo "AFTER=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("AFTER=alive");
	expect(ptyIds.size, "exactly one shell should ever have existed for this tab").toBe(1);
});

test("a shell survives a page reload", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await runInTerminal(page, "TR_RELOAD=survived");
	await runInTerminal(page, 'echo "BEFORE=$TR_RELOAD"');
	await expect(visibleTerminalScreen(page)).toContainText("BEFORE=survived");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(activeWorktreeRow(page)).toHaveCount(1);
	await waitTerminalReady(page);

	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await runInTerminal(page, 'echo "AFTER=$TR_RELOAD"');
	await expect(visibleTerminalScreen(page)).toContainText("AFTER=survived");
});

test("a terminal's output never reaches another client", async ({ page, context }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await worktreeRows(page).nth(0).click();
	await waitTerminalReady(page);

	const page2 = await context.newPage();

	const framesToB: string[] = [];
	page2.on("websocket", (ws) => {
		ws.on("framereceived", (frame) => framesToB.push(frame.payload.toString()));
	});

	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await worktreeRows(page2).nth(1).click();
	await waitTerminalReady(page2);

	await runInTerminal(page, "echo TR_SECRET_FROM_A");
	await expect(visibleTerminalScreen(page)).toContainText("TR_SECRET_FROM_A");
	await runInTerminal(page2, "echo TR_SECRET_FROM_B");
	await expect(visibleTerminalScreen(page2)).toContainText("TR_SECRET_FROM_B");

	expect(framesToB.some((frame) => frame.includes("TR_SECRET_FROM_B"))).toBe(true);

	expect(framesToB.some((frame) => frame.includes("TR_SECRET_FROM_A"))).toBe(false);

	await page2.close();
});

test("a tab says so when its shell exits", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await expect(visibleTerminal(page)).toHaveAttribute("data-exited", "false");

	await runInTerminal(page, "exit");

	await expect(visibleTerminal(page)).toHaveAttribute("data-exited", "true");
	await expect(visibleTerminalScreen(page)).toContainText(/\[process exited(?: with code \d+)?\]/);
});

test("Ctrl+C still interrupts while an input method is active", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const term = visibleTerminalScreen(page);

	await runInTerminal(page, "sleep 30");
	await expect(term).toContainText("sleep 30");

	const cdp = await page.context().newCDPSession(page);
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	for (const type of ["keyDown", "keyUp"] as const) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			code: "KeyC",
			modifiers: 2,
			windowsVirtualKeyCode: 229,
		});
	}

	await runInTerminal(page, "echo TR_INTERRUPTED_$((21 + 21))");
	await expect(term).toContainText("TR_INTERRUPTED_42");
});

test("a shell that dies while detached is not re-attached as if alive", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	await runInTerminal(page, "(sleep 2; kill -9 $$) &");
	await page.getByTestId("project-item").first().click();
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
	await page.waitForTimeout(3500);

	await worktreeRows(page).nth(0).getByRole("button").first().click();
	const term = visibleTerminal(page);
	await expect(term).toBeVisible();

	await waitTerminalReady(page);
	await runInTerminal(page, "echo TR_REATTACH_$((7 * 6))");
	await expect(visibleTerminalScreen(page)).toContainText("TR_REATTACH_42");
});

test("a shell survives losing the connection and reconnecting", async ({ page }) => {
	let socket: WebSocketRoute | undefined;
	let socketsOpened = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		socketsOpened += 1;
		socket = ws;
		ws.connectToServer();
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	await runInTerminal(page, "TR_RECONNECT=survived");
	await runInTerminal(page, 'echo "BEFORE=$TR_RECONNECT"');
	await expect(visibleTerminalScreen(page)).toContainText("BEFORE=survived");

	expect(socketsOpened).toBe(1);
	await socket?.close();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect
		.poll(() => socketsOpened, { message: "transport should have reconnected" })
		.toBeGreaterThan(1);

	await runInTerminal(page, 'echo "AFTER=$TR_RECONNECT"');
	await expect(visibleTerminalScreen(page)).toContainText("AFTER=survived");
});

test("a terminal attach response lost with its socket is replayed exactly once", async ({
	page,
}) => {
	let createRequestId: string | undefined;
	const createRequestIds: string[] = [];
	const createdPtyIds: string[] = [];
	let droppedFirstResponse = false;

	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const text = message.toString();
			try {
				const frame = JSON.parse(text) as { id?: string; method?: string };
				if (frame.method === "terminal.attach" && frame.id) {
					createRequestId ??= frame.id;
					createRequestIds.push(frame.id);
				}
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => {
			const text = message.toString();
			try {
				const frame = JSON.parse(text) as {
					id?: string;
					ok?: boolean;
					result?: { id?: string };
				};
				if (frame.id === createRequestId && frame.ok && frame.result?.id) {
					createdPtyIds.push(frame.result.id);
					if (!droppedFirstResponse) {
						droppedFirstResponse = true;
						void ws.close();
						return;
					}
				}
			} catch {}
			ws.send(message);
		});
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await runInTerminal(page, "echo TR_REPLAYED_CREATE_WORKS");
	await expect(visibleTerminalScreen(page)).toContainText("TR_REPLAYED_CREATE_WORKS");

	await expect.poll(() => createRequestIds.length).toBeGreaterThan(1);
	expect(droppedFirstResponse).toBe(true);
	expect(new Set(createRequestIds).size).toBe(1);
	expect(createdPtyIds.length).toBeGreaterThan(1);
	expect(new Set(createdPtyIds).size).toBe(1);
});

test("final shell output is delivered before exit after reconnect", async ({ page }) => {
	let firstSocket: WebSocketRoute | undefined;
	let socketsOpened = 0;
	let releaseReconnect: () => void = () => {};
	const reconnectAllowed = new Promise<void>((resolve) => {
		releaseReconnect = resolve;
	});

	await page.routeWebSocket(/\/ws(\?|$)/, async (ws) => {
		socketsOpened += 1;
		if (socketsOpened > 1) await reconnectAllowed;
		firstSocket ??= ws;
		ws.connectToServer();
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const term = visibleTerminalScreen(page);

	await runInTerminal(page, "M=TR_FINAL; sleep 1; printf '\\n%s_%s\\n' \"$M\" DURING_DROP; exit 7");
	await expect(term).toContainText("M=TR_FINAL");
	await firstSocket?.close();
	await page.waitForTimeout(1_500);
	await expect(page.getByTestId("connection-status")).not.toHaveAttribute(
		"data-status",
		"connected",
	);

	releaseReconnect();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect.poll(() => socketsOpened).toBeGreaterThan(1);
	await expect(term).toContainText("TR_FINAL_DURING_DROP");
	await expect(visibleTerminal(page)).toHaveAttribute("data-exited", "true");
	await expect(term).toContainText("[process exited with code 7]");
	const screen = await term.textContent();
	const outputIndex = screen?.indexOf("TR_FINAL_DURING_DROP") ?? -1;
	const exitIndex = screen?.indexOf("[process exited with code 7]") ?? -1;
	expect(outputIndex).toBeGreaterThanOrEqual(0);
	expect(exitIndex).toBeGreaterThan(outputIndex);
});
test("a second client takes a terminal over and the first is told", async ({ page, context }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await runInTerminal(page, "TR_SHARED=yes");
	await runInTerminal(page, 'echo "FIRST=$TR_SHARED"');
	await expect(visibleTerminalScreen(page)).toContainText("FIRST=yes");

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await worktreeRows(page2).nth(0).click();
	await waitTerminalReady(page2);

	await expect(page2.getByTestId("terminal-tab")).toHaveCount(1);
	await runInTerminal(page2, 'echo "SECOND=$TR_SHARED"');
	await expect(visibleTerminalScreen(page2)).toContainText("SECOND=yes");

	await expect(visibleTerminal(page)).toHaveAttribute("data-detached", "true");

	await page.getByTestId("terminal-take-back").click();
	await waitTerminalReady(page);
	await runInTerminal(page, 'echo "BACK=$TR_SHARED"');
	await expect(visibleTerminalScreen(page)).toContainText("BACK=yes");

	await page2.close();
});

test("closing a tab with a running process asks first", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	await runInTerminal(page, "sleep 45");
	await page.waitForTimeout(1500);

	await page.getByTestId("terminal-tab-close").first().click();
	await expect(page.getByTestId("confirm-dialog")).toBeVisible();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
	await expect(page.getByTestId("terminal-tab")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("terminal-instance")).toHaveCount(1);

	await page.getByTestId("terminal-tab-close").first().click();
	await expect(page.getByTestId("confirm-dialog")).toBeVisible();
	await page.getByTestId("terminal-close-busy-confirm").click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(0);
});

test("a rejected forced close stays correlated and permits a clean retry", async ({ page }) => {
	let rejectNextForce = true;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const text = message.toString();
			try {
				const frame = JSON.parse(text) as {
					id?: string;
					method?: string;
					params?: { force?: boolean };
				};
				if (
					rejectNextForce &&
					frame.id &&
					frame.method === "terminal.close" &&
					frame.params?.force
				) {
					rejectNextForce = false;
					ws.send(
						JSON.stringify({
							id: frame.id,
							ok: true,
							result: { closed: false, busy: true },
						}),
					);
					return;
				}
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await runInTerminal(page, "sleep 45");
	await page.waitForTimeout(1500);

	await page.getByTestId("terminal-tab-close").click();
	await expect(page.getByTestId("confirm-dialog")).toBeVisible();
	await page.getByTestId("terminal-close-busy-confirm").click();
	await expect(
		page.getByTestId("toast").getByText("The terminal refused the forced close"),
	).toBeVisible();
	await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);

	await page.getByTestId("terminal-tab-close").click();
	await expect(page.getByTestId("confirm-dialog")).toBeVisible();
	await page.getByRole("button", { name: "Cancel" }).click();
});

test("closing an idle tab does not ask", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await openTerminal(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);

	await page.getByTestId("terminal-tab-close").nth(1).click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
});

test("a terminal opened in one browser never creates placement in another", async ({
	page,
	context,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await worktreeRows(page2).nth(0).click();
	await waitTerminalReady(page2);
	await expect(page2.getByTestId("terminal-tab")).toHaveCount(1);

	await openTerminal(page2);
	await expect(page2.getByTestId("terminal-tab")).toHaveCount(2);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);

	await waitTerminalReady(page2);
	await expect(visibleTerminal(page2)).toHaveAttribute("data-detached", "false");
	await runInTerminal(page2, "echo TR_STILL_B");
	await expect(visibleTerminalScreen(page2)).toContainText("TR_STILL_B");

	await page2.getByTestId("terminal-tab-close").nth(1).click();
	await expect(page2.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);

	await page2.close();
});

test("a shell that dies during a reclaim is not presented as alive", async ({ page, context }) => {
	let delayAttachMs = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		const attachIds = new Set<string>();
		ws.onMessage((message) => {
			try {
				const frame = JSON.parse(message.toString()) as { id?: string; method?: string };
				if (frame.method === "terminal.attach" && frame.id) attachIds.add(frame.id);
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => {
			const text = message.toString();
			let frame: { id?: string } = {};
			try {
				frame = JSON.parse(text) as typeof frame;
			} catch {}
			if (frame.id && attachIds.has(frame.id) && delayAttachMs > 0) {
				setTimeout(() => ws.send(text), delayAttachMs);
				return;
			}
			ws.send(message);
		});
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await worktreeRows(page2).nth(0).click();
	await waitTerminalReady(page2);
	await expect(visibleTerminal(page)).toHaveAttribute("data-detached", "true");
	await runInTerminal(page2, "(sleep 5; kill -9 $$) &");

	delayAttachMs = 9000;
	await page.getByTestId("terminal-take-back").click();
	await expect(visibleTerminal(page)).toHaveAttribute("data-exited", "true", { timeout: 20_000 });

	await page2.close();
});
