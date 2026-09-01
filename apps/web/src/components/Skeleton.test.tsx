import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingRegion, SkeletonRows } from "./Skeleton";

const statusRegionCount = (markup: string) => (markup.match(/role="status"/g) ?? []).length;

test("SkeletonRows defaults its live-region label to Loading and clamps row count", () => {
	const markup = renderToStaticMarkup(<SkeletonRows rows={2} />);
	expect(markup).toContain('aria-label="Loading"');
	expect(markup).toContain('aria-busy="true"');
	expect(markup).toContain('data-testid="skeleton-rows"');
	expect(statusRegionCount(markup)).toBe(1);
});

test("SkeletonRows honors a custom label", () => {
	const markup = renderToStaticMarkup(<SkeletonRows label="Restoring chat" />);
	expect(markup).toContain('aria-label="Restoring chat"');
});

test("LoadingRegion wraps SkeletonRows without opening a second live region", () => {
	const markup = renderToStaticMarkup(<LoadingRegion rows={3} className="px-8 py-4" />);
	expect(statusRegionCount(markup)).toBe(1);
	expect(markup).toContain('aria-label="Loading"');
	expect(markup).toContain('class="px-8 py-4"');
});

test("LoadingRegion threads label and testId through instead of duplicating them", () => {
	const markup = renderToStaticMarkup(
		<LoadingRegion rows={4} label="Reading Git worktrees" testId="existing-worktree-loading" />,
	);
	expect(statusRegionCount(markup)).toBe(1);
	expect(markup).toContain('aria-label="Reading Git worktrees"');
	expect(markup).toContain('data-testid="existing-worktree-loading"');
});
