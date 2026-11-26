import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsChoice } from "./SettingsChoice";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsLine } from "./SettingsLine";
import { SettingsList, useSettingsListRow } from "./SettingsList";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsNumberField } from "./SettingsNumberField";
import { SettingsPage } from "./SettingsPage";
import { SettingsRow } from "./SettingsRow";
import { SettingsSlider } from "./SettingsSlider";
import { type FakeNode, h, parseMarkup } from "./settingsFakeDom.test";
import { partsOfUnit, rowsOf } from "./settingsWalk";

const TABBABLE =
	'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const action = (label: string) => (
	<button type="button" tabIndex={0}>
		{label}
	</button>
);

function ListRow({ id }: { id: string }) {
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(id);
	return (
		<li {...rowProps}>
			<button type="button" {...primaryProps}>
				{id}
			</button>
			<button type="button" aria-label="Remove" {...sideProps} />
			<button type="button" role="switch" aria-checked aria-label="On" {...sideProps} />
		</li>
	);
}

function kitPage(extra: ReactNode = null): FakeNode {
	const options = [
		{ id: "a", label: "A" },
		{ id: "b", label: "B" },
	] as const;
	return parseMarkup(
		renderToStaticMarkup(
			<SettingsPage title="Every block" description="All of them.">
				<SettingsGroup
					title="Group"
					descriptionRowId="group-steps"
					description={
						<a href="https://example.com" tabIndex={0}>
							Steps
						</a>
					}
					action={{ rowId: "group-new", control: action("New") }}
				>
					<SettingsRow
						settingId="segmented"
						label="Segmented"
						control={<SettingsChoice label="Seg" options={options} value="a" onSelect={() => {}} />}
						reset={{ changed: true, onReset: () => {} }}
					/>
					<SettingsRow
						settingId="list"
						label="List"
						layout="stacked"
						description={
							<a href="https://example.com/doc" tabIndex={0}>
								Docs
							</a>
						}
						control={
							<SettingsChoice
								label="List"
								layout="list"
								options={options}
								value="b"
								onSelect={() => {}}
							/>
						}
					/>
					<SettingsRow
						settingId="number"
						label="Number"
						control={
							<SettingsNumberField label="N" value={3} min={1} max={9} onCommit={() => undefined} />
						}
					/>
					<SettingsRow
						settingId="slider"
						label="Slider"
						control={
							<SettingsSlider
								label="S"
								value={0}
								min={-1}
								max={1}
								onChange={() => {}}
								onCommit={() => {}}
							/>
						}
					/>
					<SettingsRow
						settingId="switch"
						label="Switch"
						control={
							<button type="button" role="switch" aria-checked tabIndex={0} aria-label="On" />
						}
					/>
					<SettingsRow
						settingId="folder"
						label="Folder"
						control={action("Copy path")}
						sides={action("Open folder")}
					/>
					<SettingsDisclosure rowId="advanced" label="Advanced" defaultExpanded>
						<SettingsRow settingId="inner" label="Inner" control={action("Inner")} />
					</SettingsDisclosure>
					<SettingsNotice variant="info" rowId="starters" action={action("Add starters")}>
						None yet.
					</SettingsNotice>
					<SettingsLine rowId="retry">{action("Retry")}</SettingsLine>
					<SettingsList focusList="servers" label="Servers" rowIds={["one", "two"]}>
						<ListRow id="one" />
						<ListRow id="two" />
					</SettingsList>
					{extra}
				</SettingsGroup>
			</SettingsPage>,
		),
	);
}

function unreached(root: FakeNode): string[] {
	const reached = new Set<FakeNode>();
	for (const row of rowsOf(root)) {
		const items = row.querySelectorAll('[role="treeitem"]');
		for (const unit of items.length > 0 ? items : [row]) {
			const { stop, controls, toggle, primary, buttons } = partsOfUnit(unit);
			for (const each of [stop, toggle, primary, ...buttons]) if (each) reached.add(each);
			for (const control of controls) {
				reached.add(control);
				for (const inner of control.descendants()) reached.add(inner);
			}
		}
	}
	return root
		.querySelectorAll(TABBABLE)
		.filter((element) => !reached.has(element))
		.map((element) => element.getAttribute("aria-label") ?? element.tagName);
}

test("every tab stop the kit's blocks render is a row stop, a row's button, switch or primary, or inside its control", () => {
	const root = kitPage();
	expect(rowsOf(root).length).toBeGreaterThan(10);
	expect(root.querySelectorAll(TABBABLE).length).toBeGreaterThan(12);
	expect(unreached(root)).toEqual([]);
});

test("a button outside every row is caught", () => {
	const orphan = (
		<button type="button" tabIndex={0} aria-label="Orphan">
			x
		</button>
	);
	expect(unreached(kitPage(orphan))).toEqual(["Orphan"]);
	expect(unreached(h("div", {}, h("a", { href: "#", "aria-label": "Loose" })))).toEqual(["Loose"]);
});
