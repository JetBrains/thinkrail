export function bundledThemeSources(): Record<string, unknown> {
	return import.meta.glob("../themes/*.theme.json", { eager: true, import: "default" });
}
