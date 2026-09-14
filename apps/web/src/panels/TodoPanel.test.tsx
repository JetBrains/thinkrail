import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatTodos } from "../chat/useChatTodos";
import { TooltipProvider } from "../components/ui/tooltip";
import type { TodoChatTarget } from "../store";
import { TodoPanelAvailability, TodoPanelSessionView } from "./TodoPanel";

const target: TodoChatTarget = {
	workspaceId: "workspace-1",
	sessionId: "session-1",
	title: "Checkout flow",
};

function chatTodos(patch: Partial<ChatTodos> = {}): ChatTodos {
	return {
		data: { todos: [], groups: [] },
		failed: false,
		reload: async () => true,
		add: async () => {},
		remove: async () => {},
		openPlan: () => {},
		openChanges: () => {},
		startReview: async () => {},
		reviewAll: async () => ({ total: 0 }),
		...patch,
	};
}

test("the TODO follower asks for chat focus when none is remembered", () => {
	const markup = renderToStaticMarkup(<TodoPanelAvailability remembered={false} />);
	expect(markup).toContain("Focus a chat to see its TODO list");
});

test("a remembered chat without current authority renders content-shaped loading", () => {
	const markup = renderToStaticMarkup(<TodoPanelAvailability remembered />);
	expect(markup).toContain('data-testid="skeleton-rows"');
	expect(markup).not.toContain("Focus a chat to see its TODO list");
});

test("the TODO follower names its session, reports progress, and keeps empty-plan actions", () => {
	const plan = chatTodos({
		data: {
			todos: [
				{
					id: "todo-1",
					title: "Ship it",
					status: "done",
					origin: "agent",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			],
			groups: [],
		},
	});
	const markup = renderToStaticMarkup(
		<TooltipProvider>
			<TodoPanelSessionView target={target} plan={plan} glance="waiting" />
		</TooltipProvider>,
	);

	expect(markup).toContain('data-session-id="session-1"');
	expect(markup).toContain("Checkout flow");
	expect(markup).toContain("1 / 1");
	expect(markup).toContain('data-testid="todo-add-input"');
	expect(markup).toContain('data-testid="todo-open-plan"');
	expect(markup).toContain("Ship it");

	const empty = renderToStaticMarkup(
		<TooltipProvider>
			<TodoPanelSessionView target={target} plan={chatTodos()} glance="waiting" />
		</TooltipProvider>,
	);
	expect(empty).toContain("No TODOs yet — the agent adds its plan here, or add one above.");
});

test("the TODO follower uses content-shaped loading and a retryable error", () => {
	const loading = renderToStaticMarkup(
		<TodoPanelSessionView target={target} plan={chatTodos({ data: null })} glance="waiting" />,
	);
	expect(loading).toContain('data-testid="skeleton-rows"');
	expect(loading).not.toContain("Ship it");

	const failed = renderToStaticMarkup(
		<TodoPanelSessionView
			target={target}
			plan={chatTodos({ data: null, failed: true })}
			glance="waiting"
		/>,
	);
	expect(failed).toContain("Couldn&#x27;t load this TODO list.");
	expect(failed).toContain('data-testid="todo-panel-retry"');
	expect(failed).toContain("Retry");
	expect(failed).not.toContain("animate-pulse");
});
