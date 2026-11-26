export const SETTING_ATTR = {
	dialog: "data-settings-dialog",
	content: "data-settings-content",
	search: "data-settings-search",
	row: "data-setting-row",
	id: "data-setting-id",
	control: "data-setting-control",
	primary: "data-setting-primary",
	toggle: "data-setting-toggle",
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
	primary: `${has(SETTING_ATTR.primary)}, [data-focus-row-primary]`,
	reset: has(SETTING_ATTR.reset),
	unit: `${has(SETTING_ATTR.row)}, [role="treeitem"]`,
	tree: '[role="tree"]',
	treeItem: '[role="treeitem"]',
	listbox: '[role="listbox"]',
	toggle: `[role="switch"], ${has(SETTING_ATTR.toggle)}`,
	range: 'input[type="range"]',
	native: "button, a[href], summary",
	skipped: '[aria-hidden="true"], input[type="file"]',
} as const;

export function settingIdSelector(id: string): string {
	return `[${SETTING_ATTR.id}="${id.replace(/["\\]/g, "\\$&")}"]`;
}
