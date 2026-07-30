import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Preview tabs: a light open (single click, link follow) lands in ONE reusable italic slot per workspace;
// a deliberate open (double click) keeps its own tab. See apps/web/src/panels/SPEC.md's Preview tabs
// bullet for the gesture map, and store/SPEC.md for the slot's state rules.

/** Enter a fresh workspace with an empty tab strip and the All-files tree showing. */
async function openWorkspaceFiles(page: import("@playwright/test").Page): Promise<void> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	// The create auto-opens a chat tab; close it so the strip holds file tabs only.
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.hover();
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	await page.getByTestId("tab-files").click();
	// The tree has to be rendered before the specs that dispatch raw DOM clicks via `page.evaluate` — unlike
	// a Playwright locator, `evaluate` does not auto-wait for the row to exist.
	await expect(page.getByTestId("file-node").first()).toBeVisible();
}

test("a single click previews into one reusable slot, a double click keeps the tab", async ({
	page,
}) => {
	await openWorkspaceFiles(page);

	const tabs = page.getByTestId("editor-tab");
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(readme).toBeVisible();

	// Single click → one preview tab, marked in italics (the universal IDE signal).
	await readme.click();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toHaveAttribute("data-preview", "true");
	await expect(tabs.first().getByText("README.md")).toHaveCSS("font-style", "italic");

	// A second single click REUSES the slot rather than adding a tab — the point of the feature.
	await notes.click();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toContainText("notes.txt");
	await expect(tabs.first()).toHaveAttribute("data-preview", "true");

	// Double click keeps it — and releases the slot, since it is the same file.
	await notes.dblclick();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toHaveAttribute("data-preview", "false");
	await expect(tabs.first().getByText("notes.txt")).toHaveCSS("font-style", "normal");

	// With a kept tab in place, a single click on another file opens a NEW preview beside it.
	await readme.click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");

	// Clicking the already-active preview tab keeps it: the touch path — a phone can't rely on dblclick,
	// since with a plain width=device-width viewport a double tap is the browser's zoom gesture.
	await tabs.nth(1).getByText("README.md").click();
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "false");
	await expect(tabs).toHaveCount(2);

	// Promotion is one-way: re-previewing a kept file from the tree only focuses it, never demotes it.
	await notes.click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.first()).toHaveAttribute("data-preview", "false");
	await expect(tabs.first()).toHaveAttribute("data-active", "true");
});

// A double click IS a preview open (its leading `click`) plus a promote, so like every IDE's it claims
// the slot on the way through — the tab that was previewing is replaced, not spared. The three redundant
// reads a double click fires are collapsed to one (`openTabs.ts`'s in-flight map) so this holds at any
// round-trip latency, rather than flipping between outcomes on localhost vs. a phone over Tailscale.
test("a double click claims the slot on its way to keeping the tab, at any latency", async ({
	page,
}) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");

	// LINKS.md takes the previewing notes.txt's place and ends up kept — one tab in, one tab out.
	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).dblclick();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.nth(1)).toContainText("LINKS.md");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "false");
});

// The mechanism behind the test above, asserted directly: a double click fires `click`, `click`,
// `dblclick`, and each handler opens the same not-yet-open file. Only ONE `fs.readFile` may go out — that
// collapse is what makes the outcome independent of round-trip latency (three in-flight reads would
// otherwise be decided by whichever returned first), and it drops two redundant round-trips besides.
test("a double click on an unopened file sends exactly one fs.readFile", async ({ page }) => {
	const reads: string[] = [];
	page.on("websocket", (ws) =>
		ws.on("framesent", ({ payload }) => {
			const frame = typeof payload === "string" ? payload : payload.toString();
			if (frame.includes('"method":"fs.readFile"')) reads.push(frame);
		}),
	);

	await openWorkspaceFiles(page);
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("editor-tab")).toHaveCount(1);
	await expect(page.getByTestId("editor-tab")).toHaveAttribute("data-preview", "false");

	expect(reads.filter((frame) => frame.includes("README.md"))).toHaveLength(1);
});

// A read is slow and a click is not, so a pending browse must lose to whatever the user does next —
// otherwise, over a remote host, tapping a file and then tapping another tab yanks focus back to the file
// and claims the preview slot away from it. Both clicks are dispatched in ONE JS tick here, which
// guarantees the `fs.readFile` has not resolved and makes the interleaving deterministic rather than
// dependent on real latency.
test("a browse the user has navigated away from is dropped, not activated on arrival", async ({
	page,
}) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toHaveAttribute("data-preview", "false");

	// Same tick: start a read for an unopened file, then navigate to the already-open tab.
	await page.evaluate(() => {
		const byText = <T extends Element>(sel: string, text: string): T => {
			const hit = [...document.querySelectorAll(sel)].find((el) => el.textContent?.includes(text));
			if (!hit) throw new Error(`no ${sel} containing ${text}`);
			return hit as unknown as T;
		};
		byText<HTMLElement>('[data-testid="file-node"]', "notes.txt").click();
		byText<HTMLElement>('[data-testid="editor-tab"]', "README.md")
			.querySelector<HTMLElement>("button")
			?.click();
	});

	// notes.txt never lands: the click on README.md superseded it.
	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.first()).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toHaveCount(0);
});

// Two browse clicks in a row: the LAST one must win. Both reads are started in one JS tick, so neither has
// resolved and both are genuinely in flight — the case where an earlier read's own commit could otherwise
// look like user navigation and drop the later one, leaving the first click's file open.
test("of two browse clicks in flight at once, the later one wins", async ({ page }) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.evaluate(() => {
		const row = (text: string): HTMLElement => {
			const hit = [...document.querySelectorAll('[data-testid="file-node"]')].find((el) =>
				el.textContent?.includes(text),
			);
			if (!hit) throw new Error(`no file-node containing ${text}`);
			return hit as HTMLElement;
		};
		row("README.md").click();
		row("notes.txt").click();
	});

	await expect(tabs).toHaveCount(1);
	await expect(tabs.first()).toContainText("notes.txt");
	await expect(tabs.first()).toHaveAttribute("data-preview", "true");
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toHaveCount(0);
});

// A read landing is NOT a navigation, so it must not supersede a browse requested after it. Double-click A
// and then browse B, all in one tick: A commits (it was deliberate) and B must still commit afterwards.
// If a completion counted as navigation, A's own commit would invalidate B and the browse would vanish.
test("a keep that lands first does not invalidate a browse requested after it", async ({
	page,
}) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.evaluate(() => {
		const row = (text: string): HTMLElement => {
			const hit = [...document.querySelectorAll('[data-testid="file-node"]')].find((el) =>
				el.textContent?.includes(text),
			);
			if (!hit) throw new Error(`no file-node containing ${text}`);
			return hit as HTMLElement;
		};
		// A real double click, as the browser dispatches it: click, click, dblclick.
		row("README.md").click();
		row("README.md").click();
		row("README.md").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		row("notes.txt").click();
	});

	await expect(tabs).toHaveCount(2);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.first()).toHaveAttribute("data-preview", "false"); // kept by the double click
	await expect(tabs.nth(1)).toContainText("notes.txt");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");
});

test("the Specs panel shares the one slot, and closing the preview tab releases it", async ({
	page,
}) => {
	await openWorkspaceFiles(page);
	const tabs = page.getByTestId("editor-tab");

	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toContainText("notes.txt");

	// A Specs-panel click is a preview open too: one slot, shared across every surface, so browsing the
	// spec graph reuses the tab the file tree was browsing in rather than opening beside it.
	await page.getByTestId("tab-specs").click();
	await page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]').click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.first()).toContainText("README.md");
	await expect(tabs.nth(1)).toContainText("SPEC.md");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");

	// Closing the preview tab releases the slot — the next single click opens a fresh preview rather than
	// hunting for a tab that no longer exists.
	await tabs.nth(1).hover();
	await tabs.nth(1).getByTestId("editor-tab-close").click();
	await expect(tabs).toHaveCount(1);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toContainText("notes.txt");
	await expect(tabs.nth(1)).toHaveAttribute("data-preview", "true");
});
