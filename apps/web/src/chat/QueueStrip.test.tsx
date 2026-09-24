import { expect, test } from "bun:test";
import type { SessionQueueState } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { nextExpansion, QueueStrip } from "./QueueStrip";

function render(queue: SessionQueueState): string {
	return renderToStaticMarkup(<QueueStrip queue={queue} onEdit={() => {}} onRemove={() => {}} />);
}

function rowCount(markup: string): number {
	return markup.split('data-testid="queue-item"').length - 1;
}

test("a single queued message renders one row and no count button", () => {
	const markup = render({ steering: [], followUp: ["only one"] });
	expect(rowCount(markup)).toBe(1);
	expect(markup).toContain("only one");
	expect(markup).not.toContain('data-testid="queue-more"');
});

test("several queued messages collapse to the nearest plus a +N more button", () => {
	const markup = render({ steering: [], followUp: ["alpha-one", "bravo-two", "charlie-three"] });
	expect(rowCount(markup)).toBe(1);
	expect(markup).toContain("alpha-one");
	expect(markup).not.toContain("bravo-two");
	expect(markup).not.toContain("charlie-three");
	expect(markup).toContain('data-testid="queue-more"');
	expect(markup).toContain("+2 more");
});

test("steering leads: the nearest shown is the first steering line", () => {
	const markup = render({ steering: ["steer-first"], followUp: ["fu"] });
	expect(rowCount(markup)).toBe(1);
	expect(markup).toContain("steer-first");
	expect(markup).toContain("+1 more");
});

test("expansion does not survive a queue drain into the next burst", () => {
	let expanded = false;
	// Burst 1: three queued messages, collapsed by default, then the user expands.
	expanded = nextExpansion(expanded, 3);
	expect(expanded).toBe(false);
	expanded = true;
	// The burst delivers down to one, then empties.
	expanded = nextExpansion(expanded, 2);
	expect(expanded).toBe(true);
	expanded = nextExpansion(expanded, 1);
	expect(expanded).toBe(false);
	expanded = nextExpansion(expanded, 0);
	expect(expanded).toBe(false);
	// Burst 2 arrives in the same chat: it must start collapsed again.
	expanded = nextExpansion(expanded, 3);
	expect(expanded).toBe(false);
});
