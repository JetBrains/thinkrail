import type { VisualizeParams } from "./schema.ts";

export const MAX_MOCKUP_BYTES = 256 * 1024;

export interface MockupDocument {
	location: string;
	label: string;
	html: string;
}

export function mockupDocuments(params: VisualizeParams): MockupDocument[] {
	if (params.type === "mockup") {
		if (params.html !== undefined) {
			return [{ location: "html", label: params.title ?? "Mockup", html: params.html }];
		}
		return [
			{ location: "before", label: "Before", html: params.before ?? "" },
			{ location: "after", label: "After", html: params.after ?? "" },
		];
	}
	if (params.type === "comparison") {
		return (params.options ?? []).flatMap((option, index) =>
			option.html === undefined
				? []
				: [{ location: `options[${index}].html`, label: option.name, html: option.html }],
		);
	}
	return [];
}

export function validateMockupShape(params: VisualizeParams): void {
	const hasHtml = params.html !== undefined;
	const hasBefore = params.before !== undefined;
	const hasAfter = params.after !== undefined;
	if (hasHtml && (hasBefore || hasAfter)) {
		throw new Error(
			"visualize: a mockup takes either `html` or `before` + `after`, not both. Call `visualize` again with one of them.",
		);
	}
	if (!hasHtml && !(hasBefore && hasAfter)) {
		throw new Error(
			'visualize: type "mockup" needs `html`, or both `before` and `after`. Call `visualize` again with the missing document.',
		);
	}
}

export function validateMockupDocument({ location, html }: MockupDocument): void {
	if (html.trim() === "") {
		throw new Error(
			`visualize: \`${location}\` is empty. Provide the mockup's HTML and call \`visualize\` again.`,
		);
	}
	const bytes = new TextEncoder().encode(html).length;
	if (bytes > MAX_MOCKUP_BYTES) {
		throw new Error(
			`visualize: \`${location}\` is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_MOCKUP_BYTES / 1024} KB. Simplify the mockup (fewer repeated rows, no embedded large images) and call \`visualize\` again.`,
		);
	}
}

const SCRIPT = /<script[\s>]/i;
const EVENT_HANDLER = /<[a-z][^>]*\son[a-z]+\s*=/i;
const REMOTE_RESOURCE =
	/(?:\b(?:src|href|srcset|poster)\s*=\s*["']?\s*(?:https?:)?\/\/)|(?:url\(\s*["']?\s*(?:https?:)?\/\/)|(?:@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\/)/i;

export function mockupNotes({ location, html }: MockupDocument): string[] {
	const notes: string[] = [];
	if (SCRIPT.test(html)) notes.push(`\`${location}\`: <script> is removed when rendered.`);
	if (EVENT_HANDLER.test(html)) {
		notes.push(`\`${location}\`: on* event handlers are removed when rendered.`);
	}
	if (REMOTE_RESOURCE.test(html)) {
		notes.push(
			`\`${location}\`: http(s) resources are blocked; inline them (SVG, data: URL) or use a workspace-relative path.`,
		);
	}
	return notes;
}

export function mockupSummary(params: VisualizeParams): string {
	const pair = params.html === undefined;
	const viewport = params.viewport ?? "desktop";
	const what = pair ? "before/after mockup" : "mockup";
	return `Rendered ${what}${params.title ? ` "${params.title}"` : ""} (${viewport}) for the user.`;
}
