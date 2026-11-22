import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EXTENSIONS = join(ROOT, "thinkrail-extensions");
const SOURCE_ROOTS = [
	join(ROOT, "apps/web/src"),
	join(ROOT, "packages/ui"),
	...readdirSync(EXTENSIONS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(EXTENSIONS, entry.name, "web"))
		.filter((path) => existsSync(path)),
];

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules") continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			out.push(...sourceFiles(path));
			continue;
		}
		if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(path);
	}
	return out;
}

test("a pass-through tooltip's wrapper is let through by the app's one stylesheet rule", () => {
	const marker = "data-pass-through";
	expect(readFileSync(fileURLToPath(new URL("./tooltip.tsx", import.meta.url)), "utf8")).toContain(
		`"${marker}"`,
	);
	expect(readFileSync(join(ROOT, "apps/web/src/styles/global.css"), "utf8")).toContain(
		`[data-radix-popper-content-wrapper]:has(> [${marker}])`,
	);
});

test("no call site hand-rolls the wrapper span", () => {
	const offenders = SOURCE_ROOTS.flatMap(sourceFiles).filter((path) =>
		/<IconTooltip[^>]*>\s*<span className="flex">/.test(readFileSync(path, "utf8")),
	);
	expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
});
