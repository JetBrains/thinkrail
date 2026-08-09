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
// empty shells, so nothing looked wrong. A shell now belongs to its tab and the remount just re-attaches.
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

	await worktreeRows(page).nth(0).getByRole("button").first().click();
	await waitTerminalReady(page);
	// The screen comes back too: the remount is a fresh xterm buffer, and attach replays the host's recording
	// into it. Without that a live shell would sit behind a blank pane and look dead.
	await expect(visibleTerminalScreen(page)).toContainText("CHECK=alive");

	// And it is genuinely the same process, not a repainted picture of a dead one.
	await runInTerminal(page, 'echo "AGAIN=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("AGAIN=alive");
});

// The race the attach redesign exists for. Leaving and re-entering faster than one round trip used to find an
// empty client-side registry — the old code took the tab's pty id OUT of it before asking the host whether that
// shell was still alive — so the remount spawned a SECOND shell and the first was left running with nothing
// pointing at it, for the life of the host. Reproduced by holding the response and re-entering inside it.
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
			} catch {
				// Not a JSON request frame.
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const text = message.toString();
			let frame: { id?: string; channel?: string; data?: { id?: string } } = {};
			try {
				frame = JSON.parse(text) as typeof frame;
			} catch {
				// Relayed verbatim below.
			}
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

	// Hold every attach answer long enough to leave and come back twice inside one round trip.
	delayAttachMs = 3000;
	for (let round = 0; round < 2; round++) {
		await page.getByTestId("project-item").first().click();
		await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
		await worktreeRows(page).nth(0).getByRole("button").first().click();
		await expect(visibleTerminal(page)).toHaveCount(1);
	}
	delayAttachMs = 0;
	await waitTerminalReady(page);

	// Same shell throughout: its state is intact, and only ever one PTY produced output for this tab.
	await runInTerminal(page, 'echo "AFTER=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("AFTER=alive");
	expect(ptyIds.size, "exactly one shell should ever have existed for this tab").toBe(1);
});

// Shells are keyed to the tab and owned by the host, not by the page — so a reload finds the ones still
// running instead of starting new ones (and leaving the old set alive with nothing pointing at them).
test("a shell survives a page reload", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await runInTerminal(page, "TR_RELOAD=survived");
	await runInTerminal(page, 'echo "BEFORE=$TR_RELOAD"');
	await expect(visibleTerminalScreen(page)).toContainText("BEFORE=survived");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	// A reload keeps no client state, so the rail comes back collapsed with nothing selected.
	await page.getByTestId("project-expand").first().click();
	await worktreeRows(page).nth(0).click();
	await waitTerminalReady(page);

	// One tab, not a second one beside a now-invisible shell.
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await runInTerminal(page, 'echo "AFTER=$TR_RELOAD"');
	await expect(visibleTerminalScreen(page)).toContainText("AFTER=survived");
});

// Regression: the host used to publish every PTY's bytes to one `terminal.data` topic that *every* socket
// subscribed to, leaving each browser to discard the frames that weren't its own. So every connected client
// received everything typed or printed in every terminal of every workspace — tokens, keys, private paths —
// which matters all the more once the host is reachable from a phone over Tailscale. Frames are now addressed
// to the one client that owns the PTY.
test("a terminal's output never reaches another client", async ({ page, context }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page); // workspace 1 — A's
	await createWorkspaceViaDialog(page); // workspace 2 — B's
	await waitTerminalReady(page);
	// Back to workspace 1, so A and B are looking at DIFFERENT terminals. Same-tab attach is a deliberate
	// takeover now (shells are owner-scoped), so the addressing guarantee is about tabs nobody attached to.
	await worktreeRows(page).nth(0).click();
	await waitTerminalReady(page);

	// A second tab on the same host, in the other workspace, with a terminal of its own.
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
	await worktreeRows(page2).nth(1).click();
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

// `terminal.exit` is only heard by a *mounted* instance, and at Project Home none are — so a shell that dies
// while nobody is looking is a state the client can never be told about. `terminal.attach` closes that gap by
// construction (a tab whose shell is gone gets a fresh one), which is why no liveness probe exists to go stale.
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
// the same request id, and the host must return the cached result rather than running the handler twice. An
// attach makes both failures observable: rejecting would leave the tab failed, while rerunning would return a
// second PTY id and orphan the first shell.
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
// Shells are owner-scoped, not page-scoped: a second browser reaches the SAME shells rather than starting a
// parallel set that leaves the first invisible and unreachable. Attach is exclusive though — a PTY has one
// size — so taking a tab over tells the displaced client instead of silently reflowing it.
test("a second client takes a terminal over and the first is told", async ({ page, context }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await runInTerminal(page, "TR_SHARED=yes");
	await runInTerminal(page, 'echo "FIRST=$TR_SHARED"');
	await expect(visibleTerminalScreen(page)).toContainText("FIRST=yes");

	// A second browser page: its own client identity, the same host and the same workspace.
	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page2.getByTestId("project-expand").first().click();
	await worktreeRows(page2).nth(0).click();
	await waitTerminalReady(page2);

	// It finds the running shell, not a fresh one — same tab, same process state.
	await expect(page2.getByTestId("terminal-tab")).toHaveCount(1);
	await runInTerminal(page2, 'echo "SECOND=$TR_SHARED"');
	await expect(visibleTerminalScreen(page2)).toContainText("SECOND=yes");

	// And the first page says so rather than sitting there looking live while its output goes elsewhere.
	await expect(visibleTerminal(page)).toHaveAttribute("data-detached", "true");

	// Taking it back reverses the handover.
	await page.getByTestId("terminal-take-back").click();
	await waitTerminalReady(page);
	await runInTerminal(page, 'echo "BACK=$TR_SHARED"');
	await expect(visibleTerminalScreen(page)).toContainText("BACK=yes");

	await page2.close();
});

// Closing a tab is now the only client-driven way to kill a shell, and shells outlive reloads — so the host
// refuses while something is running and the UI confirms first. The check and the kill are one synchronous
// host pass, so nothing started in between can die unannounced.
test("closing a tab with a running process asks first", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	await runInTerminal(page, "sleep 45");
	// Give the shell time to fork the job before we ask to close it.
	await page.waitForTimeout(1500);

	await page.getByTestId("terminal-tab-close").first().click();
	// Refused, and still there.
	await expect(page.getByTestId("confirm-dialog")).toBeVisible();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);

	await page.getByTestId("terminal-close-busy-confirm").click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(0);
});

// An idle prompt has nothing to lose, so it must not train people to click through the dialog above.
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

// Which terminals exist is shared state: the host owns the tab list, so a change in one browser has to reach
// the others. Without the broadcast, a tab closed in B left A with a dead instance mounted and still taking
// keystrokes, and a tab B opened stayed invisible to A until some later remount happened to re-read the list.
test("a tab opened or closed in one browser reaches the other", async ({ page, context }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page2.getByTestId("project-expand").first().click();
	await worktreeRows(page2).nth(0).click();
	await waitTerminalReady(page2);
	await expect(page2.getByTestId("terminal-tab")).toHaveCount(1);

	// B opens a second terminal — A must see it without touching anything.
	await page2.getByTestId("terminal-add").click();
	await expect(page2.getByTestId("terminal-tab")).toHaveCount(2);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);

	// ...and seeing it must not mean CLAIMING it. Only the tab a client is actually looking at is attached, so
	// A's row for B's new terminal is just a row. Rendering an instance per shared tab would have A's hidden
	// one attach and snatch the terminal out from under the person who just opened it.
	// (A being detached on the *first* terminal is separate and correct: B entered the workspace looking at it,
	// which is what exclusive attach means.)
	await expect(visibleTerminal(page2)).toHaveAttribute("data-detached", "false");
	await runInTerminal(page2, "echo TR_STILL_B");
	await expect(visibleTerminalScreen(page2)).toContainText("TR_STILL_B");

	// B closes it again — A converges back rather than keeping a tab whose shell is gone.
	await page2.getByTestId("terminal-tab-close").nth(1).click();
	await expect(page2.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);

	await page2.close();
});

// The prebind buffer is single-use, so reclaiming a tab has to start a fresh one: otherwise anything that
// arrives before the reclaim's response is dropped by both the inert buffer and the id that detaching cleared.
// A shell dying in that window is the case that matters — the pane would go ready over a dead PTY and accept
// keystrokes forever.
test("a shell that dies during a reclaim is not presented as alive", async ({ page, context }) => {
	let delayAttachMs = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		const attachIds = new Set<string>();
		ws.onMessage((message) => {
			try {
				const frame = JSON.parse(message.toString()) as { id?: string; method?: string };
				if (frame.method === "terminal.attach" && frame.id) attachIds.add(frame.id);
			} catch {
				// Not a JSON request frame.
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const text = message.toString();
			let frame: { id?: string } = {};
			try {
				frame = JSON.parse(text) as typeof frame;
			} catch {
				// Relayed verbatim below.
			}
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

	// B takes the tab over, then arms the shell to die — only the attached client may drive it.
	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page2.getByTestId("project-expand").first().click();
	await worktreeRows(page2).nth(0).click();
	await waitTerminalReady(page2);
	await expect(visibleTerminal(page)).toHaveAttribute("data-detached", "true");
	await runInTerminal(page2, "(sleep 5; kill -9 $$) &");

	// A reclaims, but its answer is held long enough for the shell to die first — so the exit reaches A before
	// the attach response it belongs to.
	delayAttachMs = 9000;
	await page.getByTestId("terminal-take-back").click();
	await expect(visibleTerminal(page)).toHaveAttribute("data-exited", "true", { timeout: 20_000 });

	await page2.close();
});
