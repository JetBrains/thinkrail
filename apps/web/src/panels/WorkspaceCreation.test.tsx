import { expect, test } from "bun:test";
import type { WorkspaceCreation } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceCreationRow, WorkspaceCreationView } from "./WorkspaceCreation";

const creation = (over: Partial<WorkspaceCreation> = {}): WorkspaceCreation => ({
	id: "c1",
	projectId: "p1",
	name: "workspace-5",
	branch: "workspace-5",
	baseBranch: "origin/main",
	state: "running",
	phase: "checking-out",
	progress: { done: 420, total: 1000 },
	kickoff: { text: "Add retry to the webhook", imageCount: 2 },
	startedAt: 1,
	...over,
});

const text = (key: keyof typeof EN, vars: Record<string, string | number> = {}) =>
	Object.entries(vars)
		.reduce((out, [name, value]) => out.replace(`{{${name}}}`, String(value)), String(EN[key]))
		.replaceAll("&", "&amp;")
		.replaceAll("'", "&#x27;");

function row(c: WorkspaceCreation): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<ul>
				<WorkspaceCreationRow creation={c} isActive={false} onSelect={() => {}} />
			</ul>
		</TooltipProvider>,
	);
}

function view(c: WorkspaceCreation): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<WorkspaceCreationView creation={c} />
		</TooltipProvider>,
	);
}

test("a running creation shows its percent and progress, with no actions (no cancel)", () => {
	const markup = row(creation());
	expect(markup).toContain('data-state="running"');
	expect(markup).toContain(text("panels.workspaceCreation.creatingAt", { percent: 42 }));
	expect(markup).toContain("<progress");
	expect(markup).not.toContain('data-testid="workspace-creation-retry"');
	expect(markup).not.toContain('data-testid="workspace-creation-dismiss"');

	const card = view(creation());
	expect(card).toContain(text("panels.workspaceCreation.checkingOutAt", { percent: 42 }));
	expect(card).toContain("420 of 1,000 files · from origin/main");
	expect(card).toContain("Add retry to the webhook");
	expect(card).toContain("2 images attached");
});

test("an interrupted creation offers Retry and Discard", () => {
	const interrupted = creation({ state: "interrupted" });
	const markup = row(interrupted);
	expect(markup).toContain(text("panels.workspaceCreation.interruptedAt", { percent: 42 }));
	expect(markup).toContain('data-testid="workspace-creation-retry"');
	expect(markup).toContain('data-testid="workspace-creation-dismiss"');
	expect(markup).not.toContain('data-testid="workspace-creation-edit-retry"');
	expect(markup).not.toContain("<progress");

	const card = view(interrupted);
	expect(card).toContain(text("panels.workspaceCreation.retry"));
	expect(card).toContain(text("panels.workspaceCreation.discard"));
});

test("a failed creation shows git's reason with Retry, Edit & retry and Dismiss", () => {
	const failed = creation({
		state: "failed",
		phase: "preparing",
		failure: { message: "git checkout failed: No space left on device", cleanedUp: true },
	});
	const markup = row(failed);
	expect(markup).toContain(text("panels.workspaceCreation.failed"));
	expect(markup).toContain('data-testid="workspace-creation-edit-retry"');

	const card = view(failed);
	expect(card).toContain('data-testid="workspace-creation-reason"');
	expect(card).toContain("git checkout failed: No space left on device");
	expect(card).toContain(text("panels.workspaceCreation.retry"));
	expect(card).toContain(text("panels.workspaceCreation.editRetry"));
	expect(card).toContain(text("panels.workspaceCreation.cleanedUp"));

	const nothingRemoved = view({ ...failed, failure: { message: "Could not fetch origin/main" } });
	expect(nothingRemoved).not.toContain(text("panels.workspaceCreation.cleanedUp"));
});
