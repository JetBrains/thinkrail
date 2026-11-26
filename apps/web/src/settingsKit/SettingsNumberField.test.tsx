import { describe, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsNumberField, type SettingsNumberFieldProps } from "./SettingsNumberField";
import { findProps, headlessReact } from "./settingsFakeDom.test";

const react = headlessReact();

interface InputProps {
	value?: string;
	placeholder?: string;
	"aria-invalid"?: boolean;
	"data-setting-clean"?: string;
	onChange?: (event: { currentTarget: { value: string } }) => void;
	onBlur?: () => void;
}

async function mountField(props: Omit<SettingsNumberFieldProps, "label" | "onCommit">) {
	const commits: (number | null)[] = [];
	let rendered: ReactNode = null;
	function Probe({ value }: { value: number | null }) {
		rendered = SettingsNumberField({
			...props,
			label: "Limit",
			value,
			onCommit: (next) => {
				commits.push(next);
				return undefined;
			},
		});
		return null;
	}
	const render = react.mount();
	await render(<Probe value={props.value} />);
	const input = () => {
		const found = findProps<InputProps>(rendered, (each) => each.onChange !== undefined);
		if (!found) throw new Error("no input");
		return found;
	};
	return {
		commits,
		input,
		host: (value: number | null) => render(<Probe value={value} />),
		type: async (draft: string) => {
			await act(async () => input().onChange?.({ currentTarget: { value: draft } }));
			await act(async () => input().onBlur?.());
		},
	};
}

describe("SettingsNumberField", () => {
	test("an empty value shows the placeholder and stays clean", () => {
		const markup = renderToStaticMarkup(
			<SettingsNumberField
				label="Limit"
				value={null}
				min={1}
				max={8}
				placeholder="4"
				onCommit={() => undefined}
				onClear={() => undefined}
			/>,
		);
		const input = markup.match(/<input[^>]*>/)?.[0] ?? "";
		expect(input).toContain('value=""');
		expect(input).toContain('placeholder="4"');
		expect(input).toContain("data-setting-clean");
		expect(input).toContain('aria-invalid="false"');
	});

	test("with onClear, emptying a set value clears it and a number sets it again", async () => {
		const cleared: string[] = [];
		const field = await mountField({
			value: 3,
			min: 1,
			max: 8,
			onClear: () => {
				cleared.push("clear");
				return undefined;
			},
		});
		await field.type("");
		expect(cleared).toEqual(["clear"]);
		expect(field.input()["aria-invalid"]).toBe(false);
		await field.host(null);
		await field.type("6");
		expect(field.commits).toEqual([6]);
		await field.host(6);
		await field.type("9");
		expect(field.input()["aria-invalid"]).toBe(true);
		expect(field.commits).toEqual([6]);
	});

	test("without onClear an empty draft is out of range and never sent", async () => {
		const field = await mountField({ value: 5, min: 1, max: 8 });
		await field.type("");
		expect(field.input()["aria-invalid"]).toBe(true);
		expect(field.commits).toEqual([]);
	});
});
