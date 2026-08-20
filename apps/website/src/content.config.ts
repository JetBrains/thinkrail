import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

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

const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,99}$/;

const blog = defineCollection({
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
