import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsSwitch } from "./SettingsSwitch";

test("settings switches expose one accessible checked-state contract", () => {
	const on = renderToStaticMarkup(
		<SettingsSwitch checked label="Enable feature" testId="feature-toggle" onChange={() => {}} />,
	);
	const off = renderToStaticMarkup(
		<SettingsSwitch
			checked={false}
			label="Enable feature"
			testId="feature-toggle"
			onChange={() => {}}
		/>,
	);

	expect(on).toContain('role="switch"');
	expect(on).toContain('aria-checked="true"');
	expect(on).toContain('data-testid="feature-toggle"');
	expect(on).toContain('data-active="true"');
	expect(on).toContain("translate-x-16");
	expect(off).toContain('aria-checked="false"');
	expect(off).toContain('data-active="false"');
	expect(off).not.toContain("translate-x-16");
});
