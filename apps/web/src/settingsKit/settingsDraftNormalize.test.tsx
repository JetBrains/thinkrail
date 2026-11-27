import { expect, test } from "bun:test";
import { act } from "react";
import { type SettingsDraft, useSettingsDraft } from "./settingsDraft";
import { headlessReact } from "./settingsFakeDom.test";

const react = headlessReact();

async function mountTrimmed(saved: string) {
	const commits: string[] = [];
	let draft: SettingsDraft | null = null;
	function Probe({ value }: { value: string }) {
		draft = useSettingsDraft({
			saved: value,
			isValid: (next) => next.trim().length > 0,
			normalize: (next) => next.trim(),
			commit: (next) => {
				commits.push(next);
				return Promise.resolve(true);
			},
		});
		return null;
	}
	const render = react.mount();
	await render(<Probe value={saved} />);
	const current = () => {
		if (!draft) throw new Error("not mounted");
		return draft;
	};
	return {
		commits,
		current,
		host: (value: string) => render(<Probe value={value} />),
		type: (next: string) =>
			act(async () => current().inputProps.onChange({ currentTarget: { value: next } } as never)),
		blur: () => act(async () => current().inputProps.onBlur()),
	};
}

test("a normalized draft is sent once, as normalized, and settles clean on the host's echo", async () => {
	const field = await mountTrimmed("~/thinkrail");
	await field.type("  ~/code  ");
	await field.blur();
	await field.blur();
	expect(field.commits).toEqual(["~/code"]);
	expect(field.current().draft).toBe("~/code");
	await field.host("~/code");
	expect(field.current().dirty).toBe(false);
});

test("a draft that normalizes to the saved value is tidied, not sent", async () => {
	const field = await mountTrimmed("~/code");
	await field.type(" ~/code ");
	await field.blur();
	expect(field.commits).toEqual([]);
	expect(field.current().draft).toBe("~/code");
	expect(field.current().dirty).toBe(false);
});
