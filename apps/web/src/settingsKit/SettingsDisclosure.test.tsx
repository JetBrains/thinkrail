import { expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { type SettingsJump, SettingsJumpContext } from "./jumpToSetting";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { findProps, headlessReact } from "./settingsFakeDom.test";

const react = headlessReact();

interface ToggleProps {
	"aria-expanded"?: boolean;
	onClick?: () => void;
}

test("every jump to a setting inside a collapsed disclosure opens it, a repeat jump too", async () => {
	let rendered: ReactNode = null;
	function Probe() {
		rendered = SettingsDisclosure({
			rowId: "advanced",
			label: "Advanced",
			settingIds: ["left-groups"],
			children: null,
		});
		return null;
	}
	const render = react.mount();
	const show = (jump: SettingsJump | null) =>
		render(
			<SettingsJumpContext value={jump}>
				<Probe />
			</SettingsJumpContext>,
		);
	const toggle = () => {
		const found = findProps<ToggleProps>(rendered, (props) => "aria-expanded" in props);
		if (!found) throw new Error("no toggle");
		return found;
	};

	await show(null);
	expect(toggle()["aria-expanded"]).toBe(false);
	await show({ id: "other", seq: 1 });
	expect(toggle()["aria-expanded"]).toBe(false);
	await show({ id: "left-groups", seq: 2 });
	expect(toggle()["aria-expanded"]).toBe(true);
	await act(async () => toggle().onClick?.());
	expect(toggle()["aria-expanded"]).toBe(false);
	await show({ id: "left-groups", seq: 2 });
	expect(toggle()["aria-expanded"]).toBe(false);
	await show({ id: "left-groups", seq: 3 });
	expect(toggle()["aria-expanded"]).toBe(true);
});
