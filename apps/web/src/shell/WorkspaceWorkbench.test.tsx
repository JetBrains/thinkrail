import { expect, test } from "bun:test";
import type { SessionState, SessionStateRecord } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { useAppStore } from "../store";
import { AppResourceHost } from "./AppResourceHost";
import type { WorkspaceLayoutDocument } from "./layout";
import { WorkspaceWorkbench } from "./WorkspaceWorkbench";

const quiet: SessionState = {
	execution: "idle",
	runId: null,
	needsInput: null,
	completion: null,
	completionUnread: false,
	queuedCount: 0,
	backgroundWork: false,
};
const finished: SessionState = {
	...quiet,
	completion: { completionId: "done", outcome: "succeeded" },
	completionUnread: true,
};
const waiting: SessionState = {
	...quiet,
	needsInput: { interactionId: "tool:q1", kind: "tool-response", toolCallId: "q1" },
};
const document: WorkspaceLayoutDocument = {
	version: 2,
	center: {
		kind: "group",
		id: "center",
		tabs: ["a", "b", "missing"].map((sessionId) => ({
			kind: "chat",
			id: `tab-${sessionId}`,
			name: sessionId,
			sessionId,
		})),
	},
	left: { visible: false, width: 0.2, groups: [] },
	right: { visible: false, width: 0.2, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

function renderWorkbench(state: SessionState, selected = "a"): string {
	const initial = useAppStore.getInitialState();
	const saved = { ...initial };
	const record = (sessionId: string, session: SessionState): SessionStateRecord => ({
		sessionId,
		workspaceId: "w",
		projectId: "p",
		state: session,
	});
	Object.assign(initial, {
		activeWorkspaceId: "w",
		layoutDocumentsByWorkspace: { w: document },
		layoutAttentionByWorkspace: {
			w: {
				selectedByGroup: { center: `tab-${selected}` },
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: {},
			},
		},
		sessionStateByWorkspace: {
			w: { a: record("a", quiet), b: record("b", state) },
			other: { a: { ...record("a", finished), workspaceId: "other" } },
		},
	});
	try {
		return renderToStaticMarkup(
			<TooltipProvider>
				<AppResourceHost>
					<WorkspaceWorkbench workspaceId="w" />
				</AppResourceHost>
			</TooltipProvider>,
		);
	} finally {
		Object.assign(initial, saved);
	}
}

function tabButton(html: string, sessionId: string): string {
	const start = html.indexOf(`data-session-id="${sessionId}"`);
	expect(start).toBeGreaterThanOrEqual(0);
	const end = html.indexOf("</button>", start);
	expect(end).toBeGreaterThan(start);
	return html.slice(start, end);
}

test.each([
	["an unread completion", finished],
	["a pending input", waiting],
] as const)("chat tabs identify the session with %s", (_label, state) => {
	const html = renderWorkbench(state);
	expect(tabButton(html, "b")).toContain('aria-label="Needs attention"');
	expect(tabButton(html, "a")).not.toContain('data-testid="attention-dot"');
	expect(tabButton(html, "missing")).not.toContain('data-testid="attention-dot"');
});

test("the active tab retains attention until the host clears its unread or input state", () => {
	expect(tabButton(renderWorkbench(finished, "b"), "b")).toContain('data-testid="attention-dot"');
	expect(
		tabButton(renderWorkbench({ ...finished, completionUnread: false }, "b"), "b"),
	).not.toContain('data-testid="attention-dot"');
	expect(tabButton(renderWorkbench(waiting, "b"), "b")).toContain('data-testid="attention-dot"');
	expect(tabButton(renderWorkbench(quiet, "b"), "b")).not.toContain('data-testid="attention-dot"');
});

test("working, quiet, missing, and other-workspace sessions do not light a tab", () => {
	const html = renderWorkbench({ ...quiet, execution: "running", runId: "running" });
	for (const sessionId of ["a", "b", "missing"]) {
		expect(tabButton(html, sessionId)).not.toContain('data-testid="attention-dot"');
	}
});
