import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	choiceFocus,
	choiceStep,
	SettingsChoice,
	SettingsChoiceGroup,
	type SettingsChoiceOption,
} from "./SettingsChoice";

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
