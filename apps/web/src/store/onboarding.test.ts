import { expect, test } from "bun:test";
import type { Workspace } from "@thinkrail/contracts";
import {
	type ChatTab,
	EMPTY_RUNTIME,
	NO_ONBOARDING,
	type OnboardingState,
	type SessionRuntime,
} from "./appStore";
import {
	selectAgentStarted,
	selectDemoWorkspaces,
	selectOnboardingActive,
	selectOnboardingStep,
} from "./selectors";

const DEMO = "demo-project";

function ws(id: string, kind?: "default"): Workspace {
	return {
		id,
		projectId: DEMO,
		name: id,
		branch: id,
		worktreePath: `/wt/${id}`,
		baseBranch: "main",
		...(kind ? { kind } : {}),
	};
}

function chatTab(workspaceId: string, sessionId: string): ChatTab {
	return { kind: "chat", id: `tab-${sessionId}`, workspaceId, name: "Chat", sessionId };
}

function withUserTurn(): SessionRuntime {
	return {
		...EMPTY_RUNTIME,
		turns: [{ kind: "user", id: "u1", message: { role: "user", content: "hi", timestamp: 0 } }],
	};
}

const onboarding: OnboardingState = { flow: "demo", demoProjectId: DEMO, dismissed: false };

function baseState(workspaces: Workspace[]) {
	return {
		onboarding,
		workspaces: { [DEMO]: workspaces },
		sessions: {} as Record<string, SessionRuntime>,
		tabsByWorkspace: {} as Record<string, ChatTab[]>,
		closedChatsByWorkspace: {},
	};
}

test("selectOnboardingActive: true only for an armed, undismissed demo flow", () => {
	expect(selectOnboardingActive({ onboarding })).toBe(true);
	expect(selectOnboardingActive({ onboarding: { ...onboarding, dismissed: true } })).toBe(false);
	expect(selectOnboardingActive({ onboarding: NO_ONBOARDING })).toBe(false);
});

test("selectDemoWorkspaces: excludes the Default workspace", () => {
	const list = selectDemoWorkspaces({
		onboarding,
		workspaces: { [DEMO]: [ws("default", "default"), ws("a"), ws("b")] },
	});
	expect(list.map((w) => w.id)).toEqual(["a", "b"]);
});

test("step 0 until two non-Default workspaces exist", () => {
	expect(selectOnboardingStep(baseState([ws("default", "default")]))).toBe(0);
	expect(selectOnboardingStep(baseState([ws("default", "default"), ws("a")]))).toBe(0);
	expect(selectOnboardingStep(baseState([ws("a"), ws("b")]))).toBe(1);
});

test("step 1 → 2 once the first workspace's agent has a user turn", () => {
	const state = baseState([ws("a"), ws("b")]);
	state.tabsByWorkspace = { a: [chatTab("a", "s-a")] };
	state.sessions = { "s-a": withUserTurn() };
	expect(selectAgentStarted(state, "a")).toBe(true);
	expect(selectAgentStarted(state, "b")).toBe(false);
	expect(selectOnboardingStep(state)).toBe(2);
});

test("step 3 (done) once both workspaces have started an agent", () => {
	const state = baseState([ws("a"), ws("b")]);
	state.tabsByWorkspace = { a: [chatTab("a", "s-a")], b: [chatTab("b", "s-b")] };
	state.sessions = { "s-a": withUserTurn(), "s-b": withUserTurn() };
	expect(selectOnboardingStep(state)).toBe(3);
});

test("a chat tab with no user turn does not count as started", () => {
	const state = baseState([ws("a"), ws("b")]);
	state.tabsByWorkspace = { a: [chatTab("a", "s-a")] };
	state.sessions = { "s-a": EMPTY_RUNTIME };
	expect(selectOnboardingStep(state)).toBe(1);
});
