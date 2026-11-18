export const SETTING_ATTR = {
	dialog: "data-settings-dialog",
	content: "data-settings-content",
	search: "data-settings-search",
	row: "data-setting-row",
	id: "data-setting-id",
	stop: "data-setting-stop",
	control: "data-setting-control",
	side: "data-setting-side",
	reset: "data-setting-reset",
	clean: "data-setting-clean",
	pending: "data-pending",
	flash: "data-setting-flash",
} as const;

export const SETTINGS_KEY_SCOPE = {
	nav: "settings.nav",
	content: "settings",
	list: "settings.list",
} as const;

const has = (name: string) => `[${name}]`;

export const SETTING_SELECTOR = {
	row: has(SETTING_ATTR.row),
	stop: has(SETTING_ATTR.stop),
	control: has(SETTING_ATTR.control),
	side: has(SETTING_ATTR.side),
	reset: has(SETTING_ATTR.reset),
	unit: `${has(SETTING_ATTR.row)}, [role="treeitem"]`,
	tree: '[role="tree"]',
	treeItem: '[role="treeitem"]',
} as const;

export function settingIdSelector(id: string): string {
	return `[${SETTING_ATTR.id}="${id.replace(/["\\]/g, "\\$&")}"]`;
}
