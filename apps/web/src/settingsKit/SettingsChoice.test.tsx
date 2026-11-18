import { describe, expect, test } from "bun:test";
import type { LocalKeyEvent } from "@thinkrail/ui/local-keys";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type ChoiceKeyEvent,
	choiceFocus,
	choiceStep,
	SettingsChoice,
	SettingsChoiceGroup,
	type SettingsChoiceLayout,
	type SettingsChoiceOption,
	type SettingsChoiceState,
	useSettingsChoice,
} from "./SettingsChoice";
import {
	dom,
	type FakeNode,
	h,
	headlessReact,
	nameOf,
	press,
	resetDom,
} from "./settingsFakeDom.test";

type Order = "oldest" | "newest" | "custom";

const OPTIONS: SettingsChoiceOption<Order>[] = [
	{ id: "oldest", label: "Oldest first", testId: "order-oldest" },
	{ id: "newest", label: "Newest first", testId: "order-newest" },
	{ id: "custom", label: "Custom", testId: "order-custom", disabled: true },
];

const choices = (markup: string) => markup.match(/<button[^>]*role="option"[^>]*>/g) ?? [];

describe("SettingsChoice markup", () => {
	test("is a single-select listbox of option buttons with one roving tab stop on the selected option", () => {
		const markup = renderToStaticMarkup(
			<SettingsChoice label="Message order" options={OPTIONS} value="newest" onSelect={() => {}} />,
		);
		expect(markup).toContain('role="listbox"');
		expect(markup).toContain('aria-orientation="horizontal"');
		expect(markup).toContain('aria-label="Message order"');
		const [oldest, newest, custom] = choices(markup);
		expect(oldest).toContain('aria-selected="false"');
		expect(oldest).toContain('tabindex="-1"');
		expect(newest).toContain('aria-selected="true"');
		expect(newest).toContain('tabindex="0"');
		expect(newest).toContain("data-setting-stop");
		expect(newest).toContain('data-active="true"');
		expect(custom).toContain("disabled");
		expect(markup).not.toContain('type="radio"');
	});

	test("every option renders an explicit tabindex in every layout", () => {
		for (const layout of ["segmented", "list", "cards"] as const) {
			const markup = renderToStaticMarkup(
				<SettingsChoice
					label="Order"
					layout={layout}
					options={OPTIONS}
					value={null}
					onSelect={() => {}}
				/>,
			);
			const all = choices(markup);
			expect(all).toHaveLength(3);
			expect(all.every((choice) => /tabindex="(0|-1)"/.test(choice))).toBe(true);
			expect(all.filter((choice) => choice.includes('tabindex="0"'))).toHaveLength(1);
		}
	});

	test("an expensive choice waiting for Enter marks the pending option and says so", () => {
		const idle = renderToStaticMarkup(
			<SettingsChoiceGroup
				label="Language"
				cost="expensive"
				options={OPTIONS}
				value="oldest"
				waiting={null}
				onApply={() => {}}
			/>,
		);
		expect(idle).not.toContain("Press Enter to apply");
		const markup = renderToStaticMarkup(
			<SettingsChoiceGroup
				label="Language"
				cost="expensive"
				options={OPTIONS}
				value="oldest"
				waiting="newest"
				onApply={() => {}}
			/>,
		);
		expect(markup).toContain("Press Enter to apply");
		const [oldest, newest] = choices(markup);
		expect(oldest).toContain('aria-selected="true"');
		expect(oldest).toContain('tabindex="-1"');
		expect(newest).toContain('data-pending="true"');
		expect(newest).toContain('tabindex="0"');
		expect(newest).toContain("aria-describedby=");
	});
});

describe("choice movement", () => {
	test("steps to the next enabled option and stops at the edges", () => {
		expect(choiceStep(OPTIONS, "oldest", 1)).toBe("newest");
		expect(choiceStep(OPTIONS, "newest", 1)).toBeNull();
		expect(choiceStep(OPTIONS, "newest", -1)).toBe("oldest");
		expect(choiceStep(OPTIONS, "oldest", -1)).toBeNull();
		expect(choiceStep(OPTIONS, null, 1)).toBe("oldest");
		expect(choiceStep(OPTIONS, "oldest", 1, true)).toBeNull();
	});

	test("the tab stop is the pending option, else the value, else the first enabled one", () => {
		expect(choiceFocus(OPTIONS, "oldest", "newest")).toBe("newest");
		expect(choiceFocus(OPTIONS, "newest", null)).toBe("newest");
		expect(choiceFocus(OPTIONS, null, null)).toBe("oldest");
		expect(choiceFocus(OPTIONS, "custom", null)).toBe("oldest");
	});
});

const react = headlessReact();

async function mountChoice(
	cost: "cheap" | "expensive",
	layout: SettingsChoiceLayout = "segmented",
) {
	const selected: Order[] = [];
	const pending: (Order | null)[] = [];
	let state: SettingsChoiceState<Order, FakeNode> | null = null;
	function Probe({ value }: { value: Order }) {
		state = useSettingsChoice<Order, FakeNode>({
			label: "Order",
			options: OPTIONS,
			value,
			cost,
			layout,
			onSelect: (id) => selected.push(id),
			onPendingChange: (id) => pending.push(id),
		});
		return null;
	}
	const listbox = h(
		"div",
		{ role: "listbox" },
		...OPTIONS.map((option) =>
			h("button", {
				role: "option",
				"data-name": option.id,
				...(option.disabled ? { disabled: "" } : {}),
			}),
		),
	);
	const current = () => {
		if (!state) throw new Error("not rendered");
		return state;
	};
	for (const option of listbox.children) {
		option.onClick = () => {
			const id = OPTIONS.find((each) => each.id === nameOf(option))?.id;
			if (id) current().onApply(id);
		};
	}
	const render = react.mount();
	resetDom();
	await render(<Probe value="oldest" />);
	const option = (id: Order) => {
		const found = listbox.children.find((each) => nameOf(each) === id);
		if (!found) throw new Error(`no ${id}`);
		return found;
	};
	return {
		selected,
		pending,
		waiting: () => current().waiting,
		focused: () => nameOf(dom.focused),
		host: (value: Order) => render(<Probe value={value} />),
		key: async (from: Order, key: LocalKeyEvent) => {
			let prevented = false;
			const event: ChoiceKeyEvent<FakeNode> = {
				defaultPrevented: false,
				nativeEvent: key,
				target: option(from),
				currentTarget: listbox,
				preventDefault: () => {
					prevented = true;
				},
			};
			await act(async () => current().onKeyDown(event));
			return prevented;
		},
		click: (id: Order) => act(async () => option(id).click()),
		leave: () => act(async () => current().onLeave()),
	};
}

describe("SettingsChoice keys", () => {
	test("a cheap choice applies on each arrow and leaves the edges to the walk", async () => {
		const choice = await mountChoice("cheap");
		expect(await choice.key("oldest", press("ArrowRight"))).toBe(true);
		expect(choice.selected).toEqual(["newest"]);
		expect(choice.focused()).toBe("newest");
		expect(choice.waiting()).toBeNull();
		await choice.host("newest");
		expect(await choice.key("newest", press("ArrowRight"))).toBe(false);
		expect(await choice.key("newest", press("ArrowDown"))).toBe(false);
		expect(await choice.key("newest", press("KeyH", "h"))).toBe(true);
		expect(choice.selected).toEqual(["newest", "oldest"]);
		expect(choice.pending).toEqual([]);
	});

	test("a list or cards choice steps with ↑/↓ and the j/k twins, not ←/→", async () => {
		const choice = await mountChoice("cheap", "list");
		expect(await choice.key("oldest", press("ArrowRight"))).toBe(false);
		expect(await choice.key("oldest", press("KeyJ", "j"))).toBe(true);
		expect(choice.selected).toEqual(["newest"]);
		expect(await choice.key("oldest", press("ArrowUp"))).toBe(false);
	});

	test("an expensive choice moves only a pending option; Esc cancels back to the value", async () => {
		const choice = await mountChoice("expensive");
		expect(await choice.key("oldest", press("ArrowRight"))).toBe(true);
		expect(choice.selected).toEqual([]);
		expect(choice.waiting()).toBe("newest");
		expect(choice.focused()).toBe("newest");
		expect(choice.pending).toEqual(["newest"]);
		expect(await choice.key("newest", press("Escape"))).toBe(true);
		expect(choice.waiting()).toBeNull();
		expect(choice.focused()).toBe("oldest");
		expect(choice.pending).toEqual(["newest", null]);
		expect(await choice.key("oldest", press("Escape"))).toBe(false);
		expect(choice.selected).toEqual([]);
	});

	test("Enter is left to the pending option's own click, which applies it", async () => {
		const choice = await mountChoice("expensive");
		await choice.key("oldest", press("ArrowRight"));
		expect(await choice.key("newest", press("Enter"))).toBe(false);
		expect(choice.waiting()).toBe("newest");
		await act(async () => dom.focused?.click());
		expect(choice.selected).toEqual(["newest"]);
		expect(choice.waiting()).toBeNull();
		expect(choice.pending).toEqual(["newest", null]);
	});

	test("stepping back onto the value or leaving the group drops the pending option", async () => {
		const choice = await mountChoice("expensive");
		await choice.key("oldest", press("ArrowRight"));
		expect(await choice.key("newest", press("ArrowLeft"))).toBe(true);
		expect(choice.waiting()).toBeNull();
		await choice.key("oldest", press("ArrowRight"));
		await choice.leave();
		expect(choice.waiting()).toBeNull();
		expect(choice.pending).toEqual(["newest", null, "newest", null]);
		expect(choice.selected).toEqual([]);
	});

	test("a click applies at once, even on an expensive choice", async () => {
		const choice = await mountChoice("expensive");
		await choice.click("newest");
		expect(choice.selected).toEqual(["newest"]);
		await choice.click("oldest");
		expect(choice.selected).toEqual(["newest"]);
		expect(choice.pending).toEqual([]);
	});

	test("an IME composition or a modified arrow does nothing", async () => {
		const choice = await mountChoice("cheap");
		expect(
			await choice.key("oldest", press("ArrowRight", "ArrowRight", { isComposing: true })),
		).toBe(false);
		expect(await choice.key("oldest", press("ArrowRight", "ArrowRight", { shiftKey: true }))).toBe(
			false,
		);
		expect(choice.selected).toEqual([]);
	});
});
