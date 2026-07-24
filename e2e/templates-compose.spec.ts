import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";

/** The textarea's own native selection — `readSelection` reads it straight off the DOM (not React state),
 * since a slot session places a real `setSelectionRange`, not just a caret. */
async function readSelection(
	input: Locator,
): Promise<{ start: number; end: number; value: string }> {
	return input.evaluate((el) => {
		const t = el as HTMLTextAreaElement;
		return { start: t.selectionStart ?? 0, end: t.selectionEnd ?? 0, value: t.value };
	});
}

// No-agent: the composer's `/` menu template merge + slot session, against a real prompt-template file.
// `e2e/fixtures/templates.ts` seeds `${E2E_PI_AGENT_DIR}/prompts/review.md` once, in `globalSetup` — a
// global-scope template, untouched by per-test `resetState` (which only wipes `pi-agent/sessions/`), so no
// per-test re-seed is needed here (unlike the external-cwd session fixture `history-search.spec.ts` re-seeds
// per test). The fixture's body is:
//   Review $1 for issues, focusing on ${2:-src/}.
// with `argument-hint: "[file] [scope]"` — one unfilled marker slot (`⟨file⟩`, no default) and one
// prefilled-default slot ("src/"), exercising both `slotSession.ts` slot flavors end to end. Sending in this
// suite works the same way `history-search.spec.ts` relies on: `ChatView.onSubmit` appends the user message
// to the store *before* the (here, rejected — no auth in this suite) transport call resolves, so the sent
// text lands in the transcript regardless of what the (absent) agent does next.
test.describe("prompt templates in the composer", () => {
	test("full lifecycle: filter, pick, fill, tab to the default, and send strips no markers", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		// `/rev` matches only the fixture template (no builtin/extension/skill command name contains "rev").
		await input.fill("/rev");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("/review");

		// Picking replaces the draft with the expanded body — the unfilled `$1` became a visible `⟨file⟩`
		// marker, `${2:-src/}` became its own default text "src/" — and starts a slot session on slot 1/2.
		await rows.first().click();
		await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);

		const hint = page.getByTestId("slot-hint");
		await expect(hint).toBeVisible();
		await expect(hint).toContainText("slot 1/2");

		// The selection sits exactly on the `⟨file⟩` marker (computed from the live value, not a hardcoded
		// offset), so typing over it — a real DOM selection, not just a collapsed caret — replaces it.
		const sel1 = await readSelection(input);
		expect(sel1.value.slice(sel1.start, sel1.end)).toBe("⟨file⟩");

		await page.keyboard.type("watcher.ts");
		await expect(input).toHaveValue(/^Review watcher\.ts for issues, focusing on src\/\.\s*$/);

		// Tab jumps to slot 2/2 — the prefilled default — selecting "src/" whole.
		await input.press("Tab");
		await expect(hint).toContainText("slot 2/2");
		const sel2 = await readSelection(input);
		expect(sel2.value.slice(sel2.start, sel2.end)).toBe("src/");

		// Both slots are filled (one typed, one prefilled) — send produces a user bubble with the expanded
		// text and no leftover `⟨…⟩` marker glyphs, and the hint chip goes away with the session.
		await page.getByTestId("chat-send").click();
		const bubble = page.locator('[data-testid="chat-message"][data-role="user"]');
		await expect(bubble).toContainText("Review watcher.ts for issues, focusing on src/.");
		await expect(bubble).not.toContainText("⟨");
		await expect(hint).not.toBeVisible();
	});

	// Reviewer-flagged regression (freshness): the `/` menu's template list is fetched on every menu-open
	// transition, never cached across opens — prompt files change outside the app too (pi CLI, an editor,
	// a git pull), which no in-app invalidation signal can see. An earlier per-chat cache served such
	// externally-changed files stale for the rest of the chat; this writes a file straight to the global
	// prompts dir (bypassing the wire, exactly like an external tool) between two menu opens.
	test("a template file added outside the app appears on the next menu open", async ({ page }) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		const freshFile = join(E2E_PI_AGENT_DIR, "prompts", "freshly-added.md");

		try {
			// First open: the externally-added template doesn't exist yet.
			await input.fill("/rev");
			await expect(rows.filter({ hasText: "/review" })).toBeVisible();
			await input.fill("/freshly");
			await expect(rows).toHaveCount(0);

			// An "external tool" (here: the test itself, straight to disk) adds a template file.
			writeFileSync(freshFile, "---\ndescription: Added outside the app\n---\nFresh body $1\n");

			// Close the menu (empty draft) and reopen — the new file must be offered without any in-app
			// save/delete having bumped an invalidation counter.
			await input.fill("");
			await input.fill("/freshly");
			await expect(rows.filter({ hasText: "/freshly-added" })).toBeVisible();
		} finally {
			rmSync(freshFile, { force: true }); // never leak into other tests' template listings
		}
	});

	// Reviewer-flagged regression (data loss): collapsing the marker's selection to its END (ArrowRight —
	// the most natural "deselect" gesture) and then typing hits the composer's grow-at-end path, which
	// used to grow the slot WITHOUT marking it filled — `stripUntouchedSlots` then deleted the marker
	// together with everything the user had typed into it on send. Growing now fills: the typed text must
	// survive in the sent message. (The still-visible `⟨file⟩` glyphs are the composer's WYSIWYG contract —
	// the user sees them next to their text and can delete them; only *untouched* markers are stripped.)
	test("typing after ArrowRight-collapsing the marker selection is never deleted by the send", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rev");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		await rows.first().click();
		await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);
		await expect(page.getByTestId("slot-hint")).toContainText("slot 1/2");

		// ArrowRight collapses the marker's selection to its end — a bare caret at the slot boundary.
		await input.press("ArrowRight");
		const sel = await readSelection(input);
		expect(sel.start).toBe(sel.end);
		expect(sel.value.slice(0, sel.start).endsWith("⟨file⟩")).toBe(true);

		await page.keyboard.type("server.ts");
		await page.getByTestId("chat-send").click();

		// The regression: this text used to vanish from the sent message entirely.
		const bubble = page.locator('[data-testid="chat-message"][data-role="user"]');
		await expect(bubble).toContainText("server.ts for issues, focusing on src/.");
	});

	// `rename.md` repeats `$1` twice (same positional slot, same `group` — see `slotSession.ts`'s `group`
	// doc) — group mirroring: filling the first occurrence and tabbing out splices that text into the
	// second occurrence too, without the user typing it twice.
	test("tabbing out of a filled slot mirrors its text into a sibling sharing its group", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rena");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("/rename");

		await rows.first().click();
		await expect(input).toHaveValue(/^Rename ⟨name⟩ and update every ⟨name⟩ reference\.\s*$/);

		const hint = page.getByTestId("slot-hint");
		await expect(hint).toContainText("slot 1/2");
		const sel1 = await readSelection(input);
		expect(sel1.value.slice(sel1.start, sel1.end)).toBe("⟨name⟩");

		await page.keyboard.type("Widget");
		await expect(input).toHaveValue(/^Rename Widget and update every ⟨name⟩ reference\.\s*$/);

		// Tab out of the now-filled first slot mirrors "Widget" into the second `⟨name⟩` occurrence — one
		// typing action fills both — and selects the just-mirrored text.
		await input.press("Tab");
		await expect(hint).toContainText("slot 2/2");
		await expect(input).toHaveValue(/^Rename Widget and update every Widget reference\.\s*$/);
		const sel2 = await readSelection(input);
		expect(sel2.value.slice(sel2.start, sel2.end)).toBe("Widget");

		await page.getByTestId("chat-send").click();
		const bubble = page.locator('[data-testid="chat-message"][data-role="user"]');
		await expect(bubble).toContainText("Rename Widget and update every Widget reference.");
		await expect(bubble).not.toContainText("⟨");
	});

	// The highlight backdrop (Task R5): `rename.md`'s two `⟨name⟩` occurrences give one gap per slot, so
	// the tint span count must match the slot count exactly, the currently-selected slot must be the one
	// marked "active", and stepping via Tab must move both the mirrored fill state and the active marker.
	test("the highlight backdrop tints each gap and tracks the active slot as Tab steps through", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rena");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(input).toHaveValue(/^Rename ⟨name⟩ and update every ⟨name⟩ reference\.\s*$/);

		const backdrop = page.getByTestId("slot-backdrop");
		await expect(backdrop).toBeVisible();
		const highlights = page.getByTestId("slot-highlight");
		// One tint span per gap — both `⟨name⟩` occurrences, none more, none folded together.
		await expect(highlights).toHaveCount(2);
		await expect(highlights.nth(0)).toHaveAttribute("data-slot-state", "active");
		await expect(highlights.nth(1)).toHaveAttribute("data-slot-state", "unfilled");

		await page.keyboard.type("Widget");
		// Tab out of the now-filled first slot mirrors "Widget" into the sibling and moves the active
		// marker to slot 2 — the backdrop must reflect both: the first gap is now filled (mirrored, not
		// untouched), and the active tint is on the second.
		await input.press("Tab");
		await expect(highlights.nth(0)).toHaveAttribute("data-slot-state", "filled");
		await expect(highlights.nth(1)).toHaveAttribute("data-slot-state", "active");

		// Sending ends the session — the backdrop unmounts along with it.
		await page.getByTestId("chat-send").click();
		await expect(backdrop).not.toBeVisible();
	});

	// Reviewer-flagged regression: mirroring used to run only inside `stepSlot` (Tab-out) — `submit()`
	// stripped untouched slots immediately, so filling slot 1 of a repeated-group template and clicking
	// Send *without* ever tabbing out sent a prompt with the sibling silently stripped instead of mirrored.
	// `submit()` now mirrors every already-filled slot into its unfilled group-mates before stripping (see
	// `slotSession.ts`'s `mirrorAllGroups`, shared with `stepSlot`'s own `mirrorSlotGroup` call).
	test("sending directly (no Tab) still mirrors a filled slot's text into its same-group sibling", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rena");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(input).toHaveValue(/^Rename ⟨name⟩ and update every ⟨name⟩ reference\.\s*$/);

		await page.keyboard.type("Widget");
		await expect(input).toHaveValue(/^Rename Widget and update every ⟨name⟩ reference\.\s*$/);

		// No Tab — send directly while the second `⟨name⟩` occurrence is still a live, untouched marker.
		await page.getByTestId("chat-send").click();
		const bubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
		await expect(bubble).toContainText("Rename Widget and update every Widget reference.");
		await expect(bubble).not.toContainText("⟨");
	});

	test("Escape ends the session and leaves the text as-is", async ({ page }) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		await input.fill("/rev");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();

		const hint = page.getByTestId("slot-hint");
		await expect(hint).toBeVisible();
		const before = await input.inputValue();

		await input.press("Escape");
		await expect(hint).not.toBeVisible();
		expect(await input.inputValue()).toBe(before);
	});

	test("a wholesale replacement of the draft ends the session instead of tracking a meaningless range", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		await input.fill("/rev");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(page.getByTestId("slot-hint")).toBeVisible();

		// A single-event full-value replace (no shared prefix/suffix with the templated text) — the edit
		// "consumes the entire prior value", so the session ends instead of re-tracking a now-meaningless
		// collapsed slot range at the tail of the new text.
		await input.fill("something completely different");
		await expect(page.getByTestId("slot-hint")).not.toBeVisible();
		await expect(input).toHaveValue("something completely different");
	});

	test("picking a template replaces whatever draft was already there", async ({ page }) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		await input.fill("leftover draft text");
		await input.fill("/rev");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();

		// The pick fetches `template.get` over the wire before replacing the draft, so wait on the value
		// itself (auto-retrying) rather than a one-shot `inputValue()` read racing that round trip.
		await expect(input).toHaveValue(/^Review/);
		expect(await input.inputValue()).not.toContain("leftover draft text");
	});

	test("the merged menu still shows non-template commands", async ({ page }) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		// `pi-spec-graph`'s bundled skill is wired unconditionally into every session (see
		// `packages/server/src/agent/extensions.ts`), so `skill:spec-graph` is a stable, always-present
		// non-template command — proving the merge (commands minus stale `source==="prompt"` entries, plus
		// the fresh template list) never drops the other two sources.
		await input.fill("/skill:spec-graph");
		const row = page.locator('[data-testid="slash-command"][data-source="skill"]');
		await expect(row).toHaveCount(1);
		await expect(row).toContainText("skill:spec-graph");
	});

	// `adjacent.md`'s `$1$2` (no `argument-hint`, no literal text between the two placeholders) is the
	// exact zero-gap shape the B5 review found broken: filling slot 1 across more than one keystroke used
	// to corrupt slot 2's `start`, silently absorbing typed characters into it one at a time (see
	// `slotSession.ts`'s `mapOffset` doc for the fix).
	test("filling an unfilled slot across several keystrokes never steals characters from a zero-gap sibling", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/adj");
		const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("/adjacent");

		await rows.first().click();
		await expect(input).toHaveValue(/^⟨arg1⟩⟨arg2⟩\s*$/);

		const hint = page.getByTestId("slot-hint");
		await expect(hint).toContainText("slot 1/2");
		const sel1 = await readSelection(input);
		expect(sel1.value.slice(sel1.start, sel1.end)).toBe("⟨arg1⟩");

		// The first keystroke replaces the whole selected marker (a real edit, not zero-width); the
		// remaining four are pure zero-width inserts landing exactly on the — now shrunk — shared boundary
		// with slot 2, one after another. A single keystroke can only ever steal one character, so it's the
		// repeated boundary hit across several keystrokes that actually exercises the bug.
		await page.keyboard.type("hello");
		await expect(input).toHaveValue(/^hello⟨arg2⟩\s*$/);

		// Tab to slot 2 — its selection must be exactly its own marker, never short the characters "hello"
		// stole into its left edge.
		await input.press("Tab");
		await expect(hint).toContainText("slot 2/2");
		const sel2 = await readSelection(input);
		expect(sel2.value.slice(sel2.start, sel2.end)).toBe("⟨arg2⟩");

		// Send with slot 2 still unfilled — it gets stripped, and the full "hello" (all 5 characters) must
		// survive untouched, with no marker glyph left behind.
		await page.getByTestId("chat-send").click();
		const bubble = page.locator('[data-testid="chat-message"][data-role="user"]');
		await expect(bubble).toContainText("hello");
		await expect(bubble).not.toContainText("⟨");
	});

	// Minor 2 (B5 review): every send test above ends with all slots filled — none exercises the
	// strip-at-send path against a *live*, never-touched marker. `review.md`'s `$1` (`⟨file⟩`, no default)
	// is that marker: sending without ever typing into it strips it and must collapse the doubled space it
	// would otherwise leave behind down to exactly one — not zero, not two. `toContainText`/`toHaveText`
	// always normalize whitespace before comparing, even given a plain string — a `not.toContainText("  ")`
	// assertion here would vacuously pass regardless of the actual bug — so this reads `textContent()`
	// straight off the DOM and compares it exactly.
	test("sending with a live unfilled marker strips it and collapses the doubled space to exactly one", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");

		await input.fill("/rev");
		await page.locator('[data-testid="slash-command"][data-source="prompt"]').first().click();
		await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);

		// Slot 1 (`⟨file⟩`) is never typed into — it stays live/unfilled all the way to send.
		await page.getByTestId("chat-send").click();
		const bubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
		await expect(bubble).toBeVisible();
		expect(await bubble.textContent()).toBe("Review for issues, focusing on src/.");
	});
});
