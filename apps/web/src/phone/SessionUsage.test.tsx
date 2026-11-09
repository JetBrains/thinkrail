import { expect, test } from "bun:test";
import type { SessionStats } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageBar } from "./SessionUsage";

const stats: SessionStats = {
	sessionId: "s",
	totalMessages: 4,
	tokens: { input: 80, output: 24_000, cacheRead: 2_100_000, cacheWrite: 603_000, total: 0 },
	cost: 5.435,
	contextUsage: { tokens: 124_000, contextWindow: 1_000_000, percent: 12.4 },
};

const tools = <button type="button">Resources</button>;

test("the strip is one line with the context meter and every usage part; open, it adds the toolbar's buttons and no legend text", () => {
	const shut = renderToStaticMarkup(
		<UsageBar stats={stats} open={false} onToggle={() => {}}>
			{tools}
		</UsageBar>,
	);
	expect(shut).toMatch(/<meter[^>]*value="12.4"/);
	expect(shut).toContain("12.4%/1.0M · ↑80 · ↓24k · R2.1M · W603k · $5.435");
	expect(shut).not.toContain("Resources");
	expect(shut).not.toContain("▰");
	const open = renderToStaticMarkup(
		<UsageBar stats={stats} open onToggle={() => {}}>
			{tools}
		</UsageBar>,
	);
	expect(open).toContain("Resources");
	expect(open).not.toContain(">Cumulative usage");
});

test("no stats yet means no strip", () => {
	expect(
		renderToStaticMarkup(
			<UsageBar stats={null} open={false} onToggle={() => {}}>
				{tools}
			</UsageBar>,
		),
	).toBe("");
});
