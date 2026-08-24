import {
	selectDemoWorkspaces,
	selectLastOpenChatSession,
	selectOnboardingActive,
	selectOnboardingStep,
	type useAppStore,
} from "../store";

type AppStoreState = ReturnType<typeof useAppStore.getState>;

export const SEARCH_PROMPT = "Add search functionality to the To Do app.";
export const FILTER_PROMPT = "Add a filter for completed tasks.";

export interface CoachStep {
	done?: false;
	index: 2 | 3 | 4;
	title: string;
	body: string;
	selector: string;
	insertPrompt?: string;
	sessionId?: string;
}

export const COACH_STEP_COUNT = 4;

export interface CoachDone {
	done: true;
}

export type CoachView = CoachStep | CoachDone | null;

export function selectCoach(state: AppStoreState): CoachView {
	if (!selectOnboardingActive(state)) return null;
	const demoProjectId = state.onboarding.demoProjectId;
	if (!demoProjectId) return null;

	const step = selectOnboardingStep(state);
	if (step === 3) return { done: true };

	const demoWorkspaces = selectDemoWorkspaces(state);

	if (step === 0) {
		if (demoWorkspaces.length === 0) {
			return {
				index: 2,
				title: "Create your first workspace",
				body: "ThinkRail runs each task in its own isolated worktree and branch. Create two workspaces so you can work on two tasks side by side — start with this one.",
				selector: '[data-testid="welcome-cta"]',
			};
		}
		return {
			index: 2,
			title: "Create a second workspace",
			body: "One down. Create a second workspace for the other task — each stays isolated on its own branch.",
			selector: `[data-onboarding="rail-add"][data-project-id="${demoProjectId}"]`,
		};
	}

	const target = demoWorkspaces[step === 1 ? 0 : 1];
	if (!target) return null;
	const index = step === 1 ? 3 : 4;

	if (state.activeWorkspaceId !== target.id) {
		return {
			index,
			title: step === 1 ? "Open your first workspace" : "Switch to your second workspace",
			body:
				step === 1
					? "Open the first workspace to start its agent."
					: "Switch to your second workspace — your first agent keeps running while this one starts.",
			selector: `[data-onboarding-ws="${target.id}"]`,
		};
	}

	const sessionId = selectLastOpenChatSession(state, target.id);
	return {
		index,
		title: step === 1 ? "Start the first agent" : "Run a second agent in parallel",
		body:
			step === 1
				? "Ask the agent to build the first feature, then send it."
				: "Start the second task here. Both agents run at the same time — that's parallel work.",
		selector: '[data-testid="chat-input"]',
		insertPrompt: step === 1 ? SEARCH_PROMPT : FILTER_PROMPT,
		...(sessionId ? { sessionId } : {}),
	};
}
