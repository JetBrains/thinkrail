import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Popover, PopoverTrigger } from "./popover";
import { IconTooltip, TooltipProvider } from "./tooltip";

function renderTriggerPair(wrapTrigger: boolean): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<Popover open>
				<IconTooltip label="Search open tabs" wrapTrigger={wrapTrigger}>
					<PopoverTrigger data-testid="shared-trigger">Search</PopoverTrigger>
				</IconTooltip>
			</Popover>
		</TooltipProvider>,
	);
}

const triggerState = (markup: string) =>
	markup
		.match(/<button[^>]*data-testid="shared-trigger"[^>]*>/)?.[0]
		.match(/data-state="([^"]+)"/)?.[1];

describe("IconTooltip over another Radix trigger", () => {
	test("wrapTrigger leaves the popover's data-state on the shared button", () => {
		expect(triggerState(renderTriggerPair(true))).toBe("open");
	});

	test("merging onto the child is what overwrites it", () => {
		expect(triggerState(renderTriggerPair(false))).not.toBe("open");
	});
});

const SRC = new URL("../..", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			out.push(...sourceFiles(path));
			continue;
		}
		if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(path);
	}
	return out;
}

test("no call site hand-rolls the wrapper span", () => {
	const offenders = sourceFiles(SRC).filter((path) =>
		/<IconTooltip[^>]*>\s*<span className="flex">/.test(readFileSync(path, "utf8")),
	);
	expect(offenders.map((path) => path.slice(SRC.length))).toEqual([]);
});
