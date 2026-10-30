const raw = import.meta.glob<string>("./**/*.md", {
	eager: true,
	query: "?raw",
	import: "default",
});

export function contentFile(path: string): string {
	return raw[`./${path}`] ?? "";
}
