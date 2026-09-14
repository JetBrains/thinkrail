import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPlanStripContent } from "./ChatPlan";
import type { ChatTodos } from "./useChatTodos";

const plan: ChatTodos = {
	data: { todos: [], groups: [] },
	failed: false,
	reload: async () => true,
	add: async () => {},
	remove: async () => {},
	openPlan: () => {},
	openChanges: () => {},
	startReview: async () => {},
	reviewAll: async () => ({ total: 0 }),
};

test("the chat TODO receipt keeps progress but omits disclosure outside popover mode", () => {
	const popover = renderToStaticMarkup(
		<ChatPlanStripContent plan={plan} open={false} glance="waiting" />,
	);
	expect(popover).toContain('data-testid="chat-plan-disclosure"');
	expect(popover).toContain("TODO list");
	expect(popover).toContain("0/0");

	const sideTool = renderToStaticMarkup(
		<ChatPlanStripContent plan={plan} open={false} glance="waiting" disclosure={false} />,
	);
	expect(sideTool).not.toContain('data-testid="chat-plan-disclosure"');
	expect(sideTool).toContain("TODO list");
	expect(sideTool).toContain("0/0");
});
