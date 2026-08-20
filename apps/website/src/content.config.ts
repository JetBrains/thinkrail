import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// Slugs become permanent URLs (/blog/<slug>/) — validated here so a bad one fails the build, not
// production. Reserved names collide with routes the blog owns or may own (feed endpoints, assets).
const RESERVED_SLUGS = new Set([
	"index",
	"images",
	"assets",
	"feed",
	"rss",
	"atom",
	"api",
	"admin",
	"posts",
	"tags",
	"categories",
]);

// Lowercase letters, numbers, hyphens; must start with a letter; 3-100 chars.
const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,99}$/;

const blog = defineCollection({
	// Posts stay in content/blog/<dir>/index.md with an optional images/ sibling — the layout the
	// author guide (content/blog/BLOG.md) documents.
	loader: glob({ pattern: "*/index.md", base: "./content/blog" }),
	schema: z.object({
		title: z.string().min(1),
		slug: z
			.string()
			.regex(
				SLUG_PATTERN,
				"slug must be 3-100 characters, start with a lowercase letter, and contain only lowercase letters, numbers, and hyphens",
			)
			.refine((slug) => !RESERVED_SLUGS.has(slug), {
				message: `slug is a reserved name (${[...RESERVED_SLUGS].join(", ")})`,
			}),
		date: z.coerce.date(),
		draft: z.boolean().default(false),
		excerpt: z.string().optional(),
		tags: z.array(z.string()).default([]),
	}),
});

export const collections = { blog };
