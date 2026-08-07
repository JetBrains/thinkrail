import { expect, test, type WebSocketRoute } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	visibleTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";

test("a workspace opens a terminal automatically, rooted in the worktree, with working I/O", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(1);

	// No click needed — landing on the workspace opens a terminal on its own.
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await waitTerminalReady(page);
	const term = visibleTerminalScreen(page);

	// The PTY's cwd is the worktree (its basename is the workspace branch dir).
	await runInTerminal(page, 'basename "$(pwd)"');
	await expect(term).toContainText("workspace-1");

	// Keystrokes reach the PTY and its output streams back into the buffer.
	await runInTerminal(page, "echo TR_MARKER_IO");
	await expect(term).toContainText("TR_MARKER_IO");
});

test("terminals are workspace-scoped and survive workspace switches", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page); // workspace 1 (auto terminal)
	await waitTerminalReady(page);
	await runInTerminal(page, "echo TR_WS1_BUFFER");
	await expect(visibleTerminalScreen(page)).toContainText("TR_WS1_BUFFER");

	// A fresh second workspace gets its own auto terminal — not workspace 1's.
	await createWorkspaceViaDialog(page); // workspace 2 (now active)
	await expect(worktreeRows(page)).toHaveCount(2);
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_WS1_BUFFER");

	// Back to workspace 1 → its terminal and buffer are restored (never unmounted).
	await worktreeRows(page).nth(0).getByRole("button").first().click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(visibleTerminalScreen(page)).toContainText("TR_WS1_BUFFER");
});

test("multiple terminals per workspace keep independent buffers and can be closed", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await waitTerminalReady(page); // the auto terminal (terminal 1)
	await runInTerminal(page, "echo TR_ONE");
	await expect(visibleTerminalScreen(page)).toContainText("TR_ONE");

	await openTerminal(page); // terminal 2 (now active)
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
	await runInTerminal(page, "echo TR_TWO");
	await expect(visibleTerminalScreen(page)).toContainText("TR_TWO");
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_ONE");

	// Switching tabs swaps buffers — each terminal is independent.
	await page.getByTestId("terminal-tab").nth(0).click();
	await expect(visibleTerminalScreen(page)).toContainText("TR_ONE");
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_TWO");

	// Closing a terminal removes its tab.
	await page.getByTestId("terminal-tab-close").nth(1).click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
});

// The reported bug: a Russian-layout user saw the terminal corrupt their input. The root cause was the PTY
// inheriting no locale at all — a GUI-launched host (Finder/Dock, launchd, a container) gets none — which
// leaves bash/readline *byte*-oriented, so one backspace deletes half of a two-byte character and the line
// desyncs from what the shell holds. `resolveShellEnv` now installs a UTF-8 `LANG` when the host has none.
//
// Honest scope: this pins the invariant, not the failure. It can only go red on a host that itself has no
// locale, and the e2e host inherits the developer's environment, where `LANG` is usually already set — so
// the decision logic is regression-tested at the unit level instead (`packages/shared/src/shellEnv.test.ts`
// covers every branch of `localeRepair`). What this adds is end-to-end coverage of the composition
// shellEnv → process.env → ptyEnv → PTY, which no unit test spans.
test("the terminal's shell counts characters, not bytes", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const term = visibleTerminalScreen(page);

	// "привет" is 6 characters but 12 bytes, and `wc -m` counts in the current locale — so a byte-oriented
	// shell reports 12 here. That is the same shell that deletes half a character per backspace, which is
	// what the user actually saw.
	// (`tr -d` strips the leading padding BSD `wc` adds, so the marker matches on macOS too.)
	await runInTerminal(page, "echo \"LEN=$(printf %s привет | wc -m | tr -d ' ')\"");
	await expect(term).toContainText("LEN=6");

	// And the locale making it so is genuinely a UTF-8 one, whichever name the platform resolved to.
	await runInTerminal(page, 'echo "CHARMAP=$(locale charmap)"');
	await expect(term).toContainText("CHARMAP=UTF-8");
});

// Regression: `TerminalsPanel` is mounted only inside the shell's `hasActiveWorkspace` branch, so clicking a
// project row — the deliberate "project home" gesture, which clears the active workspace — unmounted every
// terminal of *every* workspace, and each unmount closed its PTY. Anything running in one (a dev server, a
// watch build) was silently killed by a single click, with the tabs reappearing afterwards backed by new,
// empty shells, so nothing looked wrong. Instances now detach their PTY and the next mount re-adopts it.
test("a shell survives a trip to Project Home and back", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	// A shell variable is the discriminator: only *this* shell process holds it. A replacement shell echoes an
	// empty value, which is precisely what the bug produced.
	await runInTerminal(page, "TR_SURVIVOR=alive");
	await runInTerminal(page, 'echo "CHECK=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("CHECK=alive");

	// Project Home tears the whole workspace surface down, terminals included.
	await page.getByTestId("project-item").first().click();
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);

	// Back into the workspace. The remount is a fresh xterm buffer, so the old output is genuinely gone and
	// the assertion below can only pass on newly painted output from the re-adopted shell.
	await worktreeRows(page).nth(0).getByRole("button").first().click();
	await waitTerminalReady(page);
	await expect(visibleTerminalScreen(page)).not.toContainText("CHECK=alive");

	await runInTerminal(page, 'echo "CHECK=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("CHECK=alive");
});

// Regression: the host used to publish every PTY's bytes to one `terminal.data` topic that *every* socket
// subscribed to, leaving each browser to discard the frames that weren't its own. So every connected client
// received everything typed or printed in every terminal of every workspace — tokens, keys, private paths —
// which matters all the more once the host is reachable from a phone over Tailscale. Frames are now addressed
// to the one client that owns the PTY.
test("a terminal's output never reaches another client", async ({ page, context }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	// A second tab on the same host, in the same workspace, with a terminal of its own.
	const page2 = await context.newPage();

	// Record every frame B's socket RECEIVES. The assertion has to be about the wire, not the screen: the
	// client also filters incoming frames by PTY id, so a leaked frame was never *rendered* — merely
	// delivered. A rendering assertion cannot see this bug at all (verified: it passes against a full
	// broadcast).
	const framesToB: string[] = [];
	page2.on("websocket", (ws) => {
		ws.on("framereceived", (frame) => framesToB.push(frame.payload.toString()));
	});

	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page2.getByTestId("project-expand").first().click();
	await worktreeRows(page2).first().click();
	await waitTerminalReady(page2);

	// Each prints a marker only its own terminal should ever show.
	await runInTerminal(page, "echo TR_SECRET_FROM_A");
	await expect(visibleTerminalScreen(page)).toContainText("TR_SECRET_FROM_A");
	await runInTerminal(page2, "echo TR_SECRET_FROM_B");
	await expect(visibleTerminalScreen(page2)).toContainText("TR_SECRET_FROM_B");

	// Positive control: B's own output really did travel over B's socket and really was captured. Without
	// this, "A's marker is absent" could just mean the recorder never worked.
	expect(framesToB.some((frame) => frame.includes("TR_SECRET_FROM_B"))).toBe(true);

	// The actual guarantee: A's terminal bytes were never delivered to B at all. Checked after B's own marker
	// has round-tripped, so a miss means "never sent" rather than "not yet sent".
	expect(framesToB.some((frame) => frame.includes("TR_SECRET_FROM_A"))).toBe(false);

	await page2.close();
});

// Regression: `pty.onExit` only deleted the map entry, and the wire had no exit event at all — so typing `exit`
// left a tab that looked perfectly alive (cursor blinking, keystrokes accepted) while every keystroke went to
// a dead id and was silently dropped. There was no way to tell the shell was gone.
test("a tab says so when its shell exits", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await expect(visibleTerminal(page)).toHaveAttribute("data-exited", "false");

	await runInTerminal(page, "exit");

	await expect(visibleTerminal(page)).toHaveAttribute("data-exited", "true");
	await expect(visibleTerminalScreen(page)).toContainText("[process exited]");
});

// Regression for an xterm bug we work around (upstream #6065, live in 6.0.0): while a CJK input method is
// active, browsers report keyCode 229 for every keystroke, and xterm's chord table switches on keyCode with no
// 229 case — so `Ctrl+C`, `Ctrl+D` and `Escape` are dropped outright and a Chinese/Japanese/Korean user cannot
// interrupt a runaway process. `event.code` stays accurate, so we recover the chord from the physical key.
//
// CDP is what makes this testable without a real IME: it can dispatch a trusted keydown whose virtual key code
// is the IME sentinel while `code` still names the physical key — the exact shape the bug needs.
test("Ctrl+C still interrupts while an input method is active", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const term = visibleTerminalScreen(page);

	// Block the shell on something that will not finish on its own.
	await runInTerminal(page, "sleep 30");
	await expect(term).toContainText("sleep 30");

	const cdp = await page.context().newCDPSession(page);
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	for (const type of ["keyDown", "keyUp"] as const) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			code: "KeyC",
			modifiers: 2, // Ctrl
			windowsVirtualKeyCode: 229, // what an active IME reports instead of the real key
		});
	}

	// The proof has to be that the shell *executed* something, not that something was typed: the tty echoes
	// keystrokes itself even while `sleep` blocks the shell, so asserting on the typed text would pass either
	// way (it did, before this was tightened). Arithmetic the shell has to evaluate separates the two — the
	// echo shows `$((21 + 21))` literally, only a running shell prints 42.
	await runInTerminal(page, "echo TR_INTERRUPTED_$((21 + 21))");
	await expect(term).toContainText("TR_INTERRUPTED_42");
});

// The gap the detach registry opens: an instance hands its PTY to `detachedPtyByClientId` on an incidental
// unmount, but `terminal.exit` is only listened for by a *mounted* instance. At Project Home none are mounted,
// so a shell that dies while detached leaves a dead id in the registry — and the next mount adopts it, giving
// back a tab that looks perfectly alive but whose keystrokes go nowhere. That is exactly the symptom the
// exit event exists to prevent, so re-attaching has to confirm the shell is still there.
test("a shell that dies while detached is not re-attached as if alive", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	// Arm the shell to kill itself shortly, then leave — so it dies with no instance mounted to hear the exit.
	// SIGKILL specifically: an interactive zsh ignores SIGTERM, and an earlier version of this test used plain
	// `kill` and therefore passed against the very bug it was written to catch.
	await runInTerminal(page, "(sleep 2; kill -9 $$) &");
	await page.getByTestId("project-item").first().click();
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
	await page.waitForTimeout(3500);

	// Coming back must not present a dead shell as a working one.
	await worktreeRows(page).nth(0).getByRole("button").first().click();
	const term = visibleTerminal(page);
	await expect(term).toBeVisible();

	// Either it reports the shell is gone, or it gave us a working replacement. What it must NOT do is sit
	// there ready-and-alive on top of a dead PTY, so prove the shell actually executes something.
	await waitTerminalReady(page);
	await runInTerminal(page, "echo TR_REATTACH_$((7 * 6))");
	await expect(visibleTerminalScreen(page)).toContainText("TR_REATTACH_42");
});

// The reason PTY ownership is keyed to a client id rather than to a socket. The transport reconnects on its
// own with backoff, so a dropped connection is usually a hiccup, not a departure — and a shell can be holding
// real work. Had ownership been socket-scoped, this would either stop streaming for good (frames addressed to
// a dead socket) or kill the shell outright (reaping on close). The reap runs on a grace timer instead.
//
// The drop is forced by proxying the socket and closing it, rather than `context.setOffline(true)` — Chromium's
// offline emulation blocks new requests but leaves an already-open WebSocket connected, so the earlier version
// of this test never actually disconnected anything.
test("a shell survives losing the connection and reconnecting", async ({ page }) => {
	let socket: WebSocketRoute | undefined;
	let socketsOpened = 0;
	// Must be installed before the first navigation, and re-runs for the reconnect's new socket. With no message
	// handlers attached, Playwright relays both directions verbatim.
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

	// Yank the connection out from under the app; the transport reconnects on its own.
	expect(socketsOpened).toBe(1);
	await socket?.close();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	// Proof the drop was real and a NEW socket replaced it. Without this the test would pass even if
	// `close()` did nothing at all — the status would simply have stayed "connected" throughout.
	await expect
		.poll(() => socketsOpened, { message: "transport should have reconnected" })
		.toBeGreaterThan(1);

	// Same shell process, still holding its state, and its output still routed to us.
	await runInTerminal(page, 'echo "AFTER=$TR_RECONNECT"');
	await expect(visibleTerminalScreen(page)).toContainText("AFTER=survived");
});

// A response can die after the host committed a mutation. The client must replay that unresolved frame under
// the same request id, and the host must return the cached result rather than running the handler twice. A
// terminal create makes both failures observable: rejecting would leave the tab failed, while rerunning would
// return a second PTY id and orphan the first shell.
test("a terminal create response lost with its socket is replayed exactly once", async ({
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
				if (frame.method === "terminal.create" && frame.id) {
					createRequestId ??= frame.id;
					createRequestIds.push(frame.id);
				}
			} catch {
				// Non-JSON is irrelevant to this request/response assertion.
			}
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
						void ws.close(); // response never reaches the page; transport must reconnect + replay
						return;
					}
				}
			} catch {
				// Push frames are forwarded unchanged below.
			}
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
	expect(new Set(createRequestIds).size).toBe(1); // client replayed the same request id
	expect(createdPtyIds.length).toBeGreaterThan(1);
	expect(new Set(createdPtyIds).size).toBe(1); // host returned one cached handler result
});

// Natural exit is a two-frame completion: final bytes, then the exit notice. If the shell dies while its owner
// is disconnected, both must survive and retain that order. The old path retried the bytes, immediately
// disposed their batcher, and therefore reconnected with only "process exited".
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

	// Echoed command text does NOT contain the final marker contiguously; only executed output does.
	await runInTerminal(page, "M=TR_FINAL; sleep 1; printf '\\n%s_%s\\n' \"$M\" DURING_DROP; exit 7");
	await expect(term).toContainText("M=TR_FINAL"); // command reached the PTY before the yank
	await firstSocket?.close();
	await page.waitForTimeout(1_500); // shell prints + exits while no host socket exists
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

// The ownership half of the isolation fix: not just "output goes only to the owner" but "another client cannot
// write to, resize or kill a terminal it does not own". Nothing pinned that, so every ownership guard in
// `terminalManager` was freely deletable. An id the caller does not own must behave exactly like one that never
// existed — same answer, so probing ids reveals nothing about which exist.
test("another client cannot drive a terminal it does not own", async ({ page, context }) => {
	// Sniff A's own PTY id off its socket, so the probe below uses a REAL id rather than a made-up one (a
	// made-up id would pass against no ownership checks at all).
	const ptyIds: string[] = [];
	page.on("websocket", (ws) => {
		ws.on("framereceived", (frame) => {
			try {
				const msg = JSON.parse(frame.payload.toString()) as {
					channel?: string;
					data?: { id?: string };
				};
				if (msg.channel === "terminal.data" && msg.data?.id) ptyIds.push(msg.data.id);
			} catch {
				// Not a JSON push frame — irrelevant here.
			}
		});
	});

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await runInTerminal(page, "echo TR_OWNER_READY");
	await expect(visibleTerminalScreen(page)).toContainText("TR_OWNER_READY");

	const victimId = ptyIds[0];
	expect(victimId, "should have observed A's PTY id on its own socket").toBeTruthy();

	// A second client, with its own identity, tries to use A's terminal.
	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const probe = await page2.evaluate(async (id) => {
		const socket = new WebSocket(`ws://${location.host}/ws?client=probe-client`);
		await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
		const ask = (method: string, params: unknown) =>
			new Promise<{ ok?: boolean; result?: unknown }>((resolve) => {
				const frameId = `probe_${method}`;
				const onMessage = (event: MessageEvent) => {
					const frame = JSON.parse(String(event.data)) as { id?: string };
					if (frame.id !== frameId) return;
					socket.removeEventListener("message", onMessage);
					resolve(frame as { ok?: boolean; result?: unknown });
				};
				socket.addEventListener("message", onMessage);
				socket.send(JSON.stringify({ id: frameId, method, params }));
			});

		const alive = await ask("terminal.alive", { id });
		// Try to inject a command into someone else's shell, and to resize and kill it.
		const write = await ask("terminal.write", { id, data: "echo TR_INJECTED_BY_B\r" });
		const resize = await ask("terminal.resize", { id, cols: 5, rows: 2 });
		const close = await ask("terminal.close", { id });
		socket.close();
		return { alive, write, resize, close };
	}, victimId);

	// The host answers as if the id simply does not exist — no error that would confirm it does.
	expect(probe.alive.ok).toBe(true);
	expect((probe.alive.result as { alive: boolean }).alive).toBe(false);
	expect(probe.write.ok).toBe(true);
	expect(probe.resize.ok).toBe(true);
	expect(probe.close.ok).toBe(true);

	// And none of it touched A: no injected command ran, and the shell is alive and correctly sized.
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_INJECTED_BY_B");
	await runInTerminal(page, "echo TR_STILL_MINE_$((3 * 3))");
	await expect(visibleTerminalScreen(page)).toContainText("TR_STILL_MINE_9");

	await page2.close();
});
