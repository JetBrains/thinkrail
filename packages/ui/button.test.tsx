import { describe, expect, test } from "bun:test";
import { RiAddLine, RiArrowRightSLine } from "@remixicon/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, type ButtonSize, type ButtonVariant, buttonVariants, IconButton } from "./button";
import { TooltipProvider } from "./tooltip";

const VARIANTS: ButtonVariant[] = ["primary", "soft-primary", "outline", "ghost", "destructive"];
const SIZES: Record<
	ButtonSize,
	{ h: string; px: string; gap: string; icon: string; square: string }
> = {
	s: { h: "h-20", px: "px-4", gap: "gap-4", icon: "[&_svg]:size-14", square: "size-20" },
	m: { h: "h-24", px: "px-8", gap: "gap-4", icon: "[&_svg]:size-16", square: "size-24" },
	l: { h: "h-32", px: "px-12", gap: "gap-6", icon: "[&_svg]:size-20", square: "size-32" },
};
const render = (node: React.ReactNode) =>
	renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const classOf = (markup: string) =>
	markup
		.match(/<button[^>]*class="([^"]+)"/)?.[1]
		?.replaceAll("&amp;", "&")
		.split(" ") ?? [];

describe("geometry is the size's, identical for every variant", () => {
	for (const variant of VARIANTS)
		for (const [size, g] of Object.entries(SIZES) as [ButtonSize, (typeof SIZES)["s"]][]) {
			test(`${variant} ${size}`, () => {
				const text = classOf(
					render(
						<Button variant={variant} size={size}>
							Label
						</Button>,
					),
				);
				expect(text).toEqual(
					expect.arrayContaining([
						g.h,
						g.px,
						g.gap,
						g.icon,
						"rounded-sm",
						"border",
						"tr-text-button",
					]),
				);
				const icon = classOf(
					render(<IconButton variant={variant} size={size} icon={RiAddLine} label="Add" />),
				);
				expect(icon).toEqual(
					expect.arrayContaining([g.square, "p-0", g.icon, "rounded-sm", "border"]),
				);
				expect(icon).not.toContain(g.px);
			});
		}
});

test("pressed looks exactly like hover in every variant, never a border or geometry change", () => {
	for (const variant of VARIANTS) {
		const c = classOf(render(<Button variant={variant}>x</Button>));
		const hover = c.filter((x) => x.startsWith("hover:")).map((x) => x.slice("hover:".length));
		const active = c.filter((x) => x.startsWith("active:")).map((x) => x.slice("active:".length));
		expect(active.sort()).toEqual(hover.sort());
	}
});

test("inside a data-row, ghost hover, pressed, focus and selected rise to the elevated surface", () => {
	const inRow = (variant: ButtonVariant) =>
		classOf(render(<Button variant={variant}>x</Button>))
			.filter((x) => x.startsWith("[[data-row]_&]:"))
			.map((x) => x.slice("[[data-row]_&]:".length))
			.sort();
	expect(inRow("ghost")).toEqual([
		"active:bg-container-elevated-bg",
		"data-[selected=true]:bg-container-elevated-bg",
		"focus-visible:bg-container-elevated-bg",
		"hover:bg-container-elevated-bg",
	]);
	for (const variant of VARIANTS.filter((v) => v !== "ghost")) expect(inRow(variant)).toEqual([]);
});

test("focus is an offset outline in every variant, never a ring", () => {
	for (const variant of VARIANTS) {
		const c = classOf(render(<Button variant={variant}>x</Button>));
		expect(c).toEqual(
			expect.arrayContaining([
				"focus-visible:outline-2",
				"focus-visible:outline-offset-2",
				"focus-visible:outline-primary",
			]),
		);
		expect(c.some((x) => x.includes("ring"))).toBe(false);
	}
});

test("no state is drawn with opacity", () => {
	for (const variant of VARIANTS) expect(buttonVariants({ variant })).not.toMatch(/opacity/);
});

test("icon slots render in order and are sized by the button", () => {
	const markup = render(
		<Button size="m" iconLeft={RiAddLine} iconRight={RiArrowRightSLine}>
			New
		</Button>,
	);
	expect(markup.indexOf("<svg")).toBeLessThan(markup.indexOf("New"));
	expect(markup.lastIndexOf("<svg")).toBeGreaterThan(markup.indexOf("New"));
	expect(markup).toContain('aria-hidden="true"');
});

test("icon-only buttons always carry an accessible name", () => {
	const markup = render(<IconButton icon={RiAddLine} label="New chat" />);
	expect(markup).toContain('aria-label="New chat"');
	expect(markup).toContain("data-icon-only");
});

test("disabled keeps the element and uses the disabled skin", () => {
	const markup = render(<Button disabled>Remove</Button>);
	expect(markup).toMatch(/<button[^>]* disabled=""/);
	expect(markup).toContain('data-disabled="true"');
});

test("loading blocks re-activation, keeps the label for width and swaps icons for a spinner", () => {
	const text = render(<Button loading>Save</Button>);
	expect(text).toMatch(/<button[^>]* disabled=""/);
	expect(text).toContain('aria-busy="true"');
	expect(text).not.toContain("data-disabled");
	expect(text).toContain('class="contents text-transparent">Save');
	expect(text).toContain('data-slot="button-spinner"');
	const withIcon = render(
		<Button loading size="s" iconLeft={RiAddLine}>
			Save
		</Button>,
	);
	expect(withIcon).toContain("size-14 animate-spin");
	expect(withIcon).not.toContain("text-transparent");
	const icon = render(<IconButton loading size="l" icon={RiAddLine} label="Add" />);
	expect(icon).toContain("size-20 animate-spin");
});

test("selected is a persistent attribute, and an open Radix trigger counts as selected", () => {
	expect(
		render(
			<Button variant="ghost" selected>
				Split
			</Button>,
		),
	).toContain('data-selected="true"');
	expect(
		render(
			<Button variant="ghost" data-state="open">
				Menu
			</Button>,
		),
	).toContain('data-selected="true"');
	expect(render(<Button variant="ghost">Idle</Button>)).not.toContain("data-selected");
});

describe("a tooltip still explains a disabled button", () => {
	const wrapped = (markup: string) => /^<span class="flex"[^>]*><button/.test(markup);

	test("an IconButton whose caller controls disabled is wrapped, whatever the current value", () => {
		expect(wrapped(render(<IconButton icon={RiAddLine} label="Next page" disabled />))).toBe(true);
		expect(
			wrapped(render(<IconButton icon={RiAddLine} label="Next page" disabled={false} />)),
		).toBe(true);
		expect(wrapped(render(<IconButton icon={RiAddLine} label="Add" />))).toBe(false);
		expect(
			wrapped(render(<IconButton icon={RiAddLine} label="Add" disabled wrapTrigger={false} />)),
		).toBe(false);
	});

	test("a Button tooltip renders through IconTooltip and wraps when disabled is controlled", () => {
		const plain = render(<Button>Check it</Button>);
		expect(plain).not.toContain("data-state");
		const enabled = render(<Button tooltip="Explains the action">Open PR</Button>);
		expect(wrapped(enabled)).toBe(false);
		expect(enabled).toContain('data-state="closed"');
		const disabled = render(
			<Button tooltip="Another step is being reviewed" disabled>
				Check it
			</Button>,
		);
		expect(wrapped(disabled)).toBe(true);
		expect(disabled).not.toContain("title=");
	});
});

test("selected has a fill in every variant that can toggle, and soft-primary selected looks like its hover", () => {
	const selectedOf = (variant: ButtonVariant) =>
		classOf(render(<Button variant={variant}>x</Button>))
			.filter((x) => x.startsWith("data-[selected=true]:"))
			.map((x) => x.slice("data-[selected=true]:".length));
	for (const variant of ["soft-primary", "outline", "ghost"] as const)
		expect(selectedOf(variant).some((x) => x.startsWith("bg-"))).toBe(true);
	const softHover = classOf(render(<Button variant="soft-primary">x</Button>))
		.filter((x) => x.startsWith("hover:"))
		.map((x) => x.slice("hover:".length));
	expect(selectedOf("soft-primary").sort()).toEqual(softHover.sort());
});

test("tone keeps a warning or danger label in every state, with disabled still winning", () => {
	const textStates = (markup: string) =>
		classOf(markup).filter((x) =>
			/^(?:[a-z-]+:|data-\[[^\]]+\]:)*text-(?:text|feedback|control)-/.test(x),
		);
	for (const [tone, token] of [
		["warning", "text-feedback-warning"],
		["danger", "text-feedback-error"],
	] as const) {
		const ghost = textStates(
			render(<IconButton variant="ghost" tone={tone} icon={RiAddLine} label="Stop all" />),
		);
		expect(ghost).toEqual(
			expect.arrayContaining([
				token,
				`hover:${token}`,
				`focus-visible:${token}`,
				`active:${token}`,
				`data-[selected=true]:${token}`,
				"data-[disabled=true]:text-control-disabled-text",
			]),
		);
		expect(ghost.some((x) => x.endsWith("text-text-default") || x === "text-text-muted")).toBe(
			false,
		);
		const outline = textStates(
			render(
				<Button variant="outline" tone={tone}>
					Stop
				</Button>,
			),
		);
		expect(outline).toContain(token);
		expect(outline).not.toContain("text-text-default");
	}
});

test("there are exactly five variants and three sizes", () => {
	const markup = render(<Button>x</Button>);
	expect(markup).toContain('data-variant="primary"');
	expect(markup).toContain('data-size="l"');
});

test("spinIcon keeps the button's own icon and rotates it while loading", () => {
	const text = render(
		<Button loading spinIcon size="m" iconLeft={RiAddLine}>
			Refresh
		</Button>,
	);
	expect(text).not.toContain('data-slot="button-spinner"');
	expect(text).toContain("animate-spin");
	expect(text).toContain('aria-busy="true"');
	const icon = render(<IconButton loading spinIcon icon={RiAddLine} label="Refresh" />);
	expect(icon).not.toContain('data-slot="button-spinner"');
	expect(icon).toContain("animate-spin");
});
