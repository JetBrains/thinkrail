import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { commitFile } from "./fixtures/git";

// The agent-reviewer's reflection pass, end to end (@agent, real provider): Start review on a step whose
// committed change carries a blatant problem (a hallucinated import + inverted logic under a "tests pass"
// claim) drives a real reviewer to file a finding and request_changes; that fires an INDEPENDENT reflector
// which judges each finding and writes its verdict via reflect_finding. We assert only the robust fact —
// that reflection RAN (a comment carries a `reflection` verdict) — never a specific kept/refuted outcome,
// which a live model decides. Inherently slower + less deterministic than the no-agent badge test in
// review.spec.ts; on-demand only (real tokens), never a commit/CI gate.

/** Poll review.get over a throwaway socket until at least one comment carries a reflection verdict. */
async function reflectionLanded(page: Page): Promise<boolean> {
	const comments = await page.evaluate(async () => {
		const proto = location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(`${proto}//${location.host}/ws`);
		await new Promise((r) => {
			ws.onopen = r;
		});
		const request = (method: string, params: unknown) =>
			new Promise<unknown>((resolve) => {
				const id = `t_${Math.random()}`;
				ws.addEventListener("message", (ev) => {
					const msg = JSON.parse(ev.data as string);
					if (msg.id === id) resolve(msg.result);
				});
				ws.send(JSON.stringify({ id, method, params }));
			});
		const projects = (await request("project.list", {})) as { id: string }[];
		const workspaces = (await request("workspace.list", { projectId: projects[0]?.id })) as {
			id: string;
			kind?: string;
		}[];
		const workspaceId = workspaces.find((w) => w.kind !== "default")?.id;
		const snapshot = (await request("review.get", { workspaceId })) as {
			comments: { reflection?: { verdict: string } }[];
		};
		ws.close();
		return snapshot.comments;
	});
	return comments.some(
		(c) => c.reflection?.verdict === "kept" || c.reflection?.verdict === "refuted",
	);
}

test("Start review → reviewer requests changes → an independent reflector judges the findings", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const sessionId = await page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.first()
		.getAttribute("data-session-id");
	if (!sessionId) throw new Error("chat tab exposes no session id");

	// A change engineered to be an unambiguous finding: a hallucinated local import + inverted logic,
	// under a "tests pass" claim the reviewer is told to distrust — so request_changes is near-certain.
	const sha = commitFile(
		workspace.worktreePath,
		"sum.ts",
		'import { helper } from "./does-not-exist";\n\nexport const sum = (a: number, b: number): number => helper(a) - b;\n',
		"todo: add sum helper",
	);
	const todosDir = join(workspace.worktreePath, ".thinkrail", "context", "todos");
	mkdirSync(todosDir, { recursive: true });
	writeFileSync(
		join(todosDir, `${sessionId}.json`),
		JSON.stringify({
			version: 5,
			todos: [
				{
					id: "t_sum",
					title: "Add a sum helper",
					status: "done",
					origin: "agent",
					summary: "Adds two numbers via a small helper.",
					verification: "bun test — all pass",
					artifacts: [{ kind: "commit", sha, label: "Add a sum helper" }],
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-01T00:00:00Z",
				},
			],
			groups: [],
		}),
	);

	await page.getByTestId("chat-plan-toggle").click();
	await page.getByTestId("chat-plan-popover").getByTestId("todo-open-plan").click();
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();

	const item = pane.getByTestId("plan-item").filter({ hasText: "Add a sum helper" });
	await item.getByTestId("plan-start-review").click();

	// The reviewer turn then the reflector turn both run in the background; poll until a reflection verdict
	// lands on a finding (either kept or refuted proves the reflector ran and reflect_finding fired).
	await expect
		.poll(() => reflectionLanded(page), { timeout: 280_000, intervals: [4_000] })
		.toBe(true);
});
