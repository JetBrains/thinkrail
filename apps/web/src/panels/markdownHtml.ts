import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { MarkdownRehypePlugins } from "../chat/Markdown";
import { sourceLineRehype } from "./sourceLines";

export const DOCUMENT_HTML_SCHEMA: typeof defaultSchema = {
	...defaultSchema,
	clobberPrefix: "",
	tagNames: [...(defaultSchema.tagNames ?? []), "mdalert"],
	attributes: {
		...defaultSchema.attributes,
		mdalert: ["variant"],
		source: [...(defaultSchema.attributes?.source ?? []), "srcSet", "media", "type", "sizes"],
	},
};

export function documentRehypePlugins(stampOffset?: number): MarkdownRehypePlugins {
	const plugins: NonNullable<MarkdownRehypePlugins> = [
		rehypeRaw,
		[rehypeSanitize, DOCUMENT_HTML_SCHEMA],
	];
	if (stampOffset !== undefined) plugins.push([sourceLineRehype, { offset: stampOffset }]);
	return plugins;
}
