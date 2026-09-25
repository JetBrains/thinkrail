import { expect, test } from "bun:test";
import { RiChat2Line as Chat } from "@remixicon/react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunningIcon } from "./RunningIcon";

test("running icon is a store-free, labeled pulse wrapper with reduced-motion fallback", () => {
	const markup = renderToStaticMarkup(
		<RunningIcon className="text-primary">
			<Chat className="size-14 shrink-0" />
		</RunningIcon>,
	);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain("motion-safe:animate-pulse");
	expect(markup).toContain("motion-reduce:ring-1");
	expect(markup).toContain("motion-reduce:ring-current");
	expect(markup).toContain("text-primary");
	expect(markup).not.toContain("Needs attention");
	expect(markup).not.toContain("spinner");
});
