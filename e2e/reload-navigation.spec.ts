import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	activeWorktreeRow,
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	worktreeRows,
} from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

// The reload-navigation contract (apps/web/src/navigation/SPEC.md): each browser tab keeps its own
// backend-relative location in a versioned URL fragment, internal navigation replaces it, and a reload —
// or a directly opened link — restores the workspace and exact chat the fragment names, validated against
// host state. Falling back UPWARD happens only on a successful authoritative read that proves the
// resource gone; a transient failure keeps the URL and retries.

const chatTabs = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="chat"]');
const activeTab = (page: Page) => page.locator('[data-testid="editor-tab"][data-active="true"]');
const currentHash = (page: Page) => page.evaluate(() => window.location.hash);

function chatIdFromHash(hash: string): string {
	const encoded = hash.split("/chats/")[1]?.split("/")[0];
	if (!encoded) throw new Error(`hash carries no chat id: ${hash}`);
	return decodeURIComponent(encoded);
}

/** The open project's id — from host persistence, which the fixture reset rewrote for this test. */
function fixtureProjectId(): string {
	const projects = JSON.parse(readFileSync(join(E2E_DATA_DIR, "projects.json"), "utf8")) as {
		id: string;
	}[];
	const id = projects[0]?.id;
	if (!id) throw new Error("no fixture project persisted");
	return id;
}

/** Cold-load a specific fragment (about:blank in between forces a real navigation, not a hash change). */
async function coldOpen(page: Page, fragment: string): Promise<void> {
	await page.goto("about:blank");
	await page.goto(`/${fragment}`);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

test("reloading from the older of two chats returns to that exact chat without rail clicks", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page); // auto-opens chat 1
	await expect(chatTabs(page)).toHaveCount(1);
	await page.getByTestId("new-chat").click();
	await expect(chatTabs(page)).toHaveCount(2); // chat 2 is focused now

	// Go back to the OLDER chat — the fragment follows the navigation via history.replaceState.
	const older = chatTabs(page).first();
	const olderPlacementId = await older.getByRole("tab").getAttribute("data-layout-tab-id");
	if (!olderPlacementId) throw new Error("chat tab carries no layout id");
	await older.getByRole("tab").click();
	await expect(older).toHaveAttribute("data-active", "true");
	const hash = await currentHash(page);
	chatIdFromHash(hash);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	// No rail clicks: the workspace activates and the exact chat hydrates focused on their own.
	await expect(activeWorktreeRow(page)).toHaveCount(1);
	await expect(activeTab(page).getByRole("tab")).toHaveAttribute(
		"data-layout-tab-id",
		olderPlacementId,
	);
	// Both live chats still auto-restore; focus stays on the routed one, and the fragment is unchanged.
	await expect(chatTabs(page)).toHaveCount(2);
	expect(await currentHash(page)).toBe(hash);
});

test("a directly opened exact-chat fragment restores that chat; two tabs keep independent routes", async ({
	page,
	context,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(chatTabs(page)).toHaveCount(1);
	await page.getByTestId("new-chat").click();
	await expect(chatTabs(page)).toHaveCount(2);

	// Establish each route↔placement pair through an explicit selection; tab creation and the async layout
	// acknowledgement may otherwise still be converging when the second tab first appears.
	const first = chatTabs(page).first();
	await first.getByRole("tab").click();
	await expect(first).toHaveAttribute("data-active", "true");
	const firstHash = await currentHash(page);
	chatIdFromHash(firstHash);
	const firstPlacementId = await first.getByRole("tab").getAttribute("data-layout-tab-id");
	if (!firstPlacementId) throw new Error("first chat carries no layout id");

	const second = chatTabs(page).last();
	await second.getByRole("tab").click();
	await expect(second).toHaveAttribute("data-active", "true");
	await expect.poll(() => currentHash(page)).not.toBe(firstHash);
	const secondHash = await currentHash(page);
	chatIdFromHash(secondHash);
	const secondPlacementId = await second.getByRole("tab").getAttribute("data-layout-tab-id");
	if (!secondPlacementId) throw new Error("second chat carries no layout id");

	// A second browser tab opens the FIRST chat's link directly — a shareable same-origin deep link.
	const page2 = await context.newPage();
	await page2.goto(`/${firstHash}`);
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(activeTab(page2).getByRole("tab")).toHaveAttribute(
		"data-layout-tab-id",
		firstPlacementId,
	);
	expect(await currentHash(page2)).toBe(firstHash);

	// Each browser tab owns its attention and location: the first page never moved off the second chat.
	await expect(activeTab(page).getByRole("tab")).toHaveAttribute(
		"data-layout-tab-id",
		secondPlacementId,
	);
	expect(await currentHash(page)).toBe(secondHash);

	// A later incoming fragment in an ALREADY-ACTIVE workspace must trigger exact-chat hydration too — the
	// activeWorkspaceId does not change here, so this pins shell reconciliation's target-generation edge.
	await page.evaluate((hash) => {
		window.location.hash = hash;
	}, firstHash);
	await expect(activeTab(page).getByRole("tab")).toHaveAttribute(
		"data-layout-tab-id",
		firstPlacementId,
	);
	await expect.poll(() => currentHash(page)).toBe(firstHash);
	// The other browser tab remains independent throughout.
	await expect(activeTab(page2).getByRole("tab")).toHaveAttribute(
		"data-layout-tab-id",
		firstPlacementId,
	);
	expect(await currentHash(page2)).toBe(firstHash);
	await page2.close();
});

test("missing chat, workspace, and project fall back to the nearest valid location", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await expect(chatTabs(page)).toHaveCount(1);
	const projectId = fixtureProjectId();

	// Missing chat → the workspace is retained and the ordinary chat policy runs (the live chat opens);
	// only the chat half of the route is consumed.
	await coldOpen(page, `#/v1/projects/${projectId}/workspaces/${workspace.id}/chats/gone`);
	await expect(activeWorktreeRow(page)).toHaveCount(1);
	await expect(chatTabs(page).first()).toBeVisible();
	await expect
		.poll(() => currentHash(page))
		.toContain(`#/v1/projects/${projectId}/workspaces/${workspace.id}`);
	expect(await currentHash(page)).not.toContain("/chats/gone");

	// Missing workspace → its Project Home.
	await coldOpen(page, `#/v1/projects/${projectId}/workspaces/gone`);
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(activeWorktreeRow(page)).toHaveCount(0);
	await expect.poll(() => currentHash(page)).toBe(`#/v1/projects/${projectId}`);

	// Missing project → ordinary Welcome.
	await coldOpen(page, "#/v1/projects/gone/workspaces/w/chats/s");
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect.poll(() => currentHash(page)).toBe("#/v1");
});

test("a transient workspace read failure preserves the URL and restores after reconnect", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(chatTabs(page)).toHaveCount(1);
	const hash = await currentHash(page);
	const sessionId = chatIdFromHash(hash);

	// Fail the FIRST navigation-restore read (only that one carries includeDiffStats: false), then drop
	// the socket so the client reconnects — the fresh welcome retries the same unresolved intent.
	let injected = false;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: { id?: string; method?: string; params?: { includeDiffStats?: boolean } };
			try {
				frame = JSON.parse(raw) as typeof frame;
			} catch {
				server.send(message);
				return;
			}
			if (
				!injected &&
				frame.id &&
				frame.method === "workspace.list" &&
				frame.params?.includeDiffStats === false
			) {
				injected = true;
				ws.send(JSON.stringify({ id: frame.id, ok: false, error: "injected transient failure" }));
				ws.close(); // frames are ordered: the rejection lands, then the reconnect begins
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});

	await page.reload();
	// The failure is not evidence of deletion: after the reconnect retry, the exact chat is back and the
	// fragment never downgraded (a wrongly-consumed route would have landed on Welcome with #/v1).
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(activeWorktreeRow(page)).toHaveCount(1);
	await expect(activeTab(page)).toHaveAttribute("data-kind", "chat");
	expect(chatIdFromHash(await currentHash(page))).toBe(sessionId);
	expect(await currentHash(page)).toBe(hash);
	expect(injected).toBe(true);
});

test("a failed exact-chat transcript waits for reconnect instead of duplicating its read", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(chatTabs(page)).toHaveCount(1);
	const hash = await currentHash(page);
	const sessionId = chatIdFromHash(hash);

	let socketNumber = 0;
	let firstSocketTargetReads = 0;
	let closeScheduled = false;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		socketNumber += 1;
		const thisSocket = socketNumber;
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: { id?: string; method?: string; params?: { sessionId?: string } };
			try {
				frame = JSON.parse(raw) as typeof frame;
			} catch {
				server.send(message);
				return;
			}
			if (
				thisSocket === 1 &&
				frame.id &&
				frame.method === "session.getMessages" &&
				frame.params?.sessionId === sessionId
			) {
				firstSocketTargetReads += 1;
				ws.send(JSON.stringify({ id: frame.id, ok: false, error: "injected transcript failure" }));
				if (!closeScheduled) {
					closeScheduled = true;
					// Leave enough time for an accidental same-pass retry to show itself, then reconnect so the
					// retained route target gets its legitimate next attempt.
					setTimeout(() => ws.close(), 150);
				}
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});

	await page.reload();
	// Wait for the injected read itself, not the shared placement (which can render before its transcript).
	await expect.poll(() => firstSocketTargetReads).toBe(1);
	await expect.poll(() => socketNumber).toBeGreaterThanOrEqual(2);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("chat-input")).toBeVisible();
	await expect(activeTab(page)).toHaveAttribute("data-kind", "chat");
	expect(chatIdFromHash(await currentHash(page))).toBe(sessionId);
	expect(await currentHash(page)).toBe(hash);
	// Ordinary auto-open did not immediately issue the same request again or turn the still-pending target
	// into a history row on the first socket.
	expect(firstSocketTargetReads).toBe(1);
});

test("user navigation while the restore read is delayed wins over the late response", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(chatTabs(page)).toHaveCount(1);
	const projectId = fixtureProjectId();

	// Hold the navigation-restore read (never the rail's own listing, which omits includeDiffStats).
	let heldFrame: string | null = null;
	let releaseHeld: (() => void) | null = null;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		releaseHeld = () => {
			if (heldFrame) server.send(heldFrame);
			heldFrame = null;
		};
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: { method?: string; params?: { includeDiffStats?: boolean } };
			try {
				frame = JSON.parse(raw) as typeof frame;
			} catch {
				server.send(message);
				return;
			}
			if (
				heldFrame === null &&
				releaseHeld !== null &&
				frame.method === "workspace.list" &&
				frame.params?.includeDiffStats === false
			) {
				heldFrame = raw; // held until the user has navigated
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	// While the restore read hangs, the user goes to the project's Welcome — fresh navigation wins.
	await page.getByTestId("project-item").first().getByText("sample-project").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect.poll(() => currentHash(page)).toBe(`#/v1/projects/${projectId}`);

	releaseHeld?.();
	// The late response changes nothing: no workspace activates, the URL stays the user's location.
	await page.waitForTimeout(500);
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(activeWorktreeRow(page)).toHaveCount(0);
	expect(await currentHash(page)).toBe(`#/v1/projects/${projectId}`);
});

test("reload from a file tab restores its shared placement under the workspace route", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page); // no chats in the Default workspace — the receipt case
	const projectId = fixtureProjectId();

	// Open a file: the location is workspace-level (a file tab is not part of the route contract).
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="file"]')).toHaveCount(1);
	const hash = await currentHash(page);
	expect(hash).toContain(`#/v1/projects/${projectId}/workspaces/`);
	expect(hash).not.toContain("/chats/");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	// Navigation restores the workspace while the host-synchronized workbench independently restores its
	// file placement. Files still serialize at workspace granularity, never as an exact-chat route.
	await expect(page.locator('[data-testid="workspace-item"][data-kind="default"]')).toHaveAttribute(
		"data-active",
		"true",
	);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="file"]')).toHaveCount(1);
	await expect(activeTab(page)).toContainText("README.md");
	expect(await currentHash(page)).toBe(hash);
});

test("workspace rows still list after a reload restore (the light list is complete)", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(chatTabs(page)).toHaveCount(1);
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(activeWorktreeRow(page)).toHaveCount(1);
	// The restore's includeDiffStats:false list seeded the rail: the Default row and the worktree are
	// both present without any expand click (complete membership, Default pinned first).
	await expect(page.locator('[data-testid="workspace-item"][data-kind="default"]')).toBeVisible();
	await expect(worktreeRows(page)).toHaveCount(1);
});
