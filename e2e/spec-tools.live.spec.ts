import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expandActivityStep, openWorkspaceChat, waitForDone } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent to prove the bundled `pi-spec-graph`
// extension is wired into every thinkrail session end to end. The agent can only call `spec_grep` if the
// extension loaded and registered it — so a `done` spec_grep step whose result names the seeded spec file
// proves the whole path: extension loaded → tool available → core parsed the worktree's specs → match
// returned. The fixture repo is seeded (global-setup) with a root `SPEC.md` (id `sample-root`) carrying the
// distinctive token `SPECGRAPHPROBE`; the matched file *path* is NOT in the query, so it proves a real hit,
// not an echo (cf. the web_search "Paris" assertion in web-tools.live.spec.ts). `spec_grep` is ROUTINE —
// it folds into an activity group — so the test expands fold + step after the round ends.

async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

test("spec_grep is invoked against the workspace specs and rendered", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the spec_grep tool to search the project's specs for the text SPECGRAPHPROBE, then report which file it is in. Use only that tool.",
	);
	// A `spec_grep` step at all proves the bundled pi-spec-graph extension registered the tool in this live
	// session. `data-status="done"` proves it executed without error, and the seeded file path in the body
	// (which is not part of the query) proves it searched the worktree's real specs and matched.
	await waitForDone(page, 120_000);
	const step = await expandActivityStep(page, "spec_grep");
	await expect(step).toHaveAttribute("data-status", "done");
	await expect(step).toContainText("SPEC.md");
});
