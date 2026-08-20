/**
 * Blog build script — discovers Markdown posts in content/blog/, parses frontmatter,
 * converts to HTML with syntax highlighting, and generates static pages.
 *
 * IMPORTANT: This script runs AFTER `vite build` and reads the Vite manifest
 * to reference the same processed CSS (with fonts) as the main site.
 *
 * Run with: bun scripts/build-blog.ts
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import matter from "gray-matter";
import { Marked, type MarkedExtension } from "marked";
import { createHighlighter, type Highlighter } from "shiki";
import { PROD_HOST, PROJECT_KEY, PROXY_HOST, UI_HOST } from "../src/analytics";

// ── Configuration ──────────────────────────────────────────────────────────

const CONTENT_DIR = join(import.meta.dirname, "../content/blog");
const OUTPUT_DIR = join(import.meta.dirname, "../dist/blog");
const TEMPLATE_PATH = join(import.meta.dirname, "../src/blog/post-template.html");
const INDEX_TEMPLATE_PATH = join(import.meta.dirname, "../src/blog/index-template.html");
const VITE_MANIFEST_PATH = join(import.meta.dirname, "../dist/.vite/manifest.json");

// Languages to support in code blocks (kept minimal for bundle size)
const SUPPORTED_LANGUAGES = [
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"json",
	"html",
	"css",
	"bash",
	"shell",
	"powershell",
	"markdown",
	"yaml",
	"python",
	"diff",
	"plaintext",
] as const;

const SHIKI_THEMES = {
	light: "github-light",
	dark: "github-dark",
} as const;
const WORDS_PER_MINUTE = 200;

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// Template substitution helper — uses callback replacers to avoid special replacement
// patterns ($&, $1, $$) in dynamic content being misinterpreted.
function substituteTemplate(template: string, vars: Record<string, string>): string {
	return Object.entries(vars).reduce(
		(result, [key, value]) => result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), () => value),
		template,
	);
}

// ── Slug validation ───────────────────────────────────────────────────────

// Reserved names that would conflict with output structure or common routes
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

// Slug format: lowercase letters, numbers, hyphens; must start with a letter; 3-100 chars
const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,99}$/;

function validateSlug(slug: unknown, postDir: string): string {
	if (typeof slug !== "string") {
		throw new Error(`Post at ${postDir}: slug must be a string`);
	}

	if (!SLUG_PATTERN.test(slug)) {
		throw new Error(
			`Post at ${postDir}: invalid slug "${slug}". ` +
				"Slug must be 3-100 characters, start with a lowercase letter, and contain only lowercase letters, numbers, and hyphens.",
		);
	}

	if (RESERVED_SLUGS.has(slug)) {
		throw new Error(
			`Post at ${postDir}: slug "${slug}" is reserved. ` +
				`Reserved names: ${[...RESERVED_SLUGS].join(", ")}.`,
		);
	}

	return slug;
}

function formatDate(date: string): string {
	// Use UTC to avoid timezone-dependent date shifts
	const d = new Date(date);
	return d.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

function calculateReadingTime(content: string): number {
	const text = content
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`]+`/g, "")
		.replace(/!?\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/[#*_~>-]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const wordCount = text.split(/\s+/).filter((word) => word.length > 0).length;
	return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

function stripLeadingH1(content: string, title: string): string {
	const match = content.match(/^\s*#\s+(.+)\n?/);
	if (match && match[1].trim() === title.trim()) {
		return content.slice(match[0].length);
	}
	return content;
}

function resolveImagePaths(html: string, slug: string): string {
	return html.replace(/src=["']\.\/images\/([^"']+)["']/g, `src="./images/${slug}/$1"`);
}

// ── Vite manifest ──────────────────────────────────────────────────────────

interface ViteManifest {
	[key: string]: {
		file: string;
		css?: string[];
		assets?: string[];
	};
}

async function getCssPathFromManifest(): Promise<string> {
	const manifestRaw = await readFile(VITE_MANIFEST_PATH, "utf-8");
	const manifest: ViteManifest = JSON.parse(manifestRaw);

	// Find the entry that has CSS (the main entry point)
	for (const entry of Object.values(manifest)) {
		if (entry.css && entry.css.length > 0) {
			// Return path relative to /blog/ directory
			return `../${entry.css[0]}`;
		}
	}

	throw new Error("Could not find CSS in Vite manifest");
}

// ── YouTube embeds ─────────────────────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
	const patterns = [
		/youtu\.be\/([\w-]+)/,
		/youtube\.com\/watch\?v=([\w-]+)/,
		/youtube\.com\/embed\/([\w-]+)/,
		/youtube\.com\/v\/([\w-]+)/,
	];
	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) return match[1];
	}
	return null;
}

function createYouTubeExtension(): MarkedExtension {
	return {
		renderer: {
			html(token: { text: string }) {
				const text = token.text;
				const videoMatch = text.match(/<video[^>]*src=["']([^"']+)["'][^>]*>/i);
				if (videoMatch) {
					const videoId = extractYouTubeId(videoMatch[1]);
					if (videoId) {
						return `<div class="youtube-embed"><iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
					}
				}
				if (text.match(/<\/video>/i)) {
					return "";
				}
				return false;
			},
		},
	};
}

// ── Shiki ──────────────────────────────────────────────────────────────────

function createShikiExtension(hl: Highlighter): MarkedExtension {
	return {
		renderer: {
			code({ text, lang }: { text: string; lang?: string }) {
				const language = lang || "plaintext";
				const loadedLangs = hl.getLoadedLanguages();

				if (loadedLangs.includes(language as (typeof loadedLangs)[number])) {
					// Use dual themes with CSS variables for light/dark mode support
					const html = hl.codeToHtml(text, {
						lang: language,
						themes: SHIKI_THEMES,
						defaultColor: false, // Use CSS variables instead of inline color
					});
					// Remove background-color from <pre> (we style it ourselves)
					return html.replace(/background-color:[^;"]+;?/g, "");
				}

				const escaped = escapeHtml(text);
				return `<pre class="shiki"><code>${escaped}</code></pre>`;
			},
		},
	};
}

// ── Data types ─────────────────────────────────────────────────────────────

interface PostFrontmatter {
	title: string;
	slug: string;
	date: string;
	draft?: boolean;
	excerpt?: string;
	tags?: string[];
}

interface ParsedPost {
	dir: string;
	frontmatter: PostFrontmatter;
	html: string;
	readingTime: number;
}

interface PostManifestEntry {
	title: string;
	slug: string;
	date: string;
	excerpt: string;
	tags: string[];
	url: string;
	readingTime: number;
}

// ── Parsing ────────────────────────────────────────────────────────────────

async function discoverPosts(): Promise<string[]> {
	const entries = await readdir(CONTENT_DIR, { withFileTypes: true });
	return entries.filter((e) => e.isDirectory()).map((e) => join(CONTENT_DIR, e.name));
}

async function parsePost(postDir: string, md: Marked): Promise<ParsedPost> {
	const mdPath = join(postDir, "index.md");
	const raw = await readFile(mdPath, "utf-8");
	const { data, content } = matter(raw);

	if (!data.title || !data.slug || !data.date) {
		throw new Error(`Post at ${postDir} missing required frontmatter (title, slug, date)`);
	}

	// Validate slug format and reserved names
	const validatedSlug = validateSlug(data.slug, postDir);

	const frontmatter: PostFrontmatter = {
		title: data.title,
		slug: validatedSlug,
		date: data.date,
		draft: data.draft === true,
		excerpt: data.excerpt,
		tags: data.tags || [],
	};

	const body = stripLeadingH1(content, frontmatter.title);
	const html = await md.parse(body);
	const readingTime = calculateReadingTime(content);
	const resolvedHtml = resolveImagePaths(html, frontmatter.slug);

	return { dir: postDir, frontmatter, html: resolvedHtml, readingTime };
}

// ── HTML generation ────────────────────────────────────────────────────────

async function copyPostImages(postDir: string, slug: string): Promise<void> {
	const imagesDir = join(postDir, "images");
	const outputImagesDir = join(OUTPUT_DIR, "images", slug);

	if (existsSync(imagesDir)) {
		await mkdir(outputImagesDir, { recursive: true });
		await cp(imagesDir, outputImagesDir, { recursive: true });
	}
}

function generatePostPage(
	frontmatter: PostFrontmatter,
	html: string,
	template: string,
	allPosts: PostManifestEntry[],
	readingTime: number,
	cssPath: string,
): string {
	const currentIndex = allPosts.findIndex((p) => p.slug === frontmatter.slug);
	const prevPost = currentIndex > 0 ? allPosts[currentIndex - 1] : null;
	const nextPost = currentIndex < allPosts.length - 1 ? allPosts[currentIndex + 1] : null;

	const navHtml = `
		<nav class="blog-post-nav">
			${prevPost ? `<a href="./${prevPost.slug}.html" class="blog-nav-prev">← ${escapeHtml(prevPost.title)}</a>` : "<span></span>"}
			<a href="./index.html" class="blog-nav-home">All Posts</a>
			${nextPost ? `<a href="./${nextPost.slug}.html" class="blog-nav-next">${escapeHtml(nextPost.title)} →</a>` : "<span></span>"}
		</nav>
	`;

	const tagsHtml = frontmatter.tags?.length
		? `<div class="blog-post-tags">${frontmatter.tags.map((t) => `<span class="blog-tag">${escapeHtml(t)}</span>`).join("")}</div>`
		: "";

	const title = escapeHtml(frontmatter.title);
	return substituteTemplate(template, {
		cssPath,
		title,
		date: formatDate(frontmatter.date),
		readingTime: `${readingTime} min read`,
		tags: tagsHtml,
		content: html,
		navigation: navHtml,
		// Analytics constants (from src/analytics.ts)
		prodHost: PROD_HOST,
		proxyHost: PROXY_HOST,
		uiHost: UI_HOST,
		projectKey: PROJECT_KEY,
	});
}

// ── Main ───────────────────────────────────────────────────────────────────

async function build(): Promise<void> {
	console.log("📝 Building blog...");

	// Read Vite manifest to get CSS path
	console.log("   Reading Vite manifest...");
	const cssPath = await getCssPathFromManifest();
	console.log(`   CSS path: ${cssPath}`);

	// Initialize syntax highlighter
	console.log("   Initializing syntax highlighter...");
	const hl = await createHighlighter({
		themes: [SHIKI_THEMES.light, SHIKI_THEMES.dark],
		langs: [...SUPPORTED_LANGUAGES],
	});
	const md = new Marked(createYouTubeExtension(), createShikiExtension(hl));

	await mkdir(OUTPUT_DIR, { recursive: true });

	// Discover + parse all posts in parallel
	const postDirs = await discoverPosts();
	console.log(`   Found ${postDirs.length} post directories`);

	const results = await Promise.allSettled(postDirs.map((dir) => parsePost(dir, md)));
	const posts: ParsedPost[] = [];
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (r.status === "fulfilled") {
			if (r.value.frontmatter.draft) {
				console.log(`   ⏭ Skipping draft: ${r.value.frontmatter.slug}`);
			} else {
				posts.push(r.value);
			}
		} else {
			// Fail hard on broken posts — no silent green deploys
			throw new Error(`Failed to parse ${basename(postDirs[i])}: ${r.reason}`);
		}
	}

	// Validate slug uniqueness across all posts
	const slugsSeen = new Map<string, string>();
	for (const post of posts) {
		const existing = slugsSeen.get(post.frontmatter.slug);
		if (existing) {
			throw new Error(
				`Duplicate slug "${post.frontmatter.slug}" in ${basename(post.dir)} ` +
					`(already used by ${existing})`,
			);
		}
		slugsSeen.set(post.frontmatter.slug, basename(post.dir));
	}

	// Sort posts by date (newest first)
	posts.sort(
		(a, b) => new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime(),
	);

	// Build manifest (for index page generation, not output)
	const manifest: PostManifestEntry[] = posts.map((p) => ({
		title: p.frontmatter.title,
		slug: p.frontmatter.slug,
		date: p.frontmatter.date,
		excerpt: p.frontmatter.excerpt || "",
		tags: p.frontmatter.tags || [],
		url: `./${p.frontmatter.slug}.html`,
		readingTime: p.readingTime,
	}));

	// Load templates — fail hard if missing
	const template = await readFile(TEMPLATE_PATH, "utf-8");
	const indexTemplate = await readFile(INDEX_TEMPLATE_PATH, "utf-8");

	// Generate post pages
	for (const post of posts) {
		const pageHtml = generatePostPage(
			post.frontmatter,
			post.html,
			template,
			manifest,
			post.readingTime,
			cssPath,
		);
		await writeFile(join(OUTPUT_DIR, `${post.frontmatter.slug}.html`), pageHtml);
		await copyPostImages(post.dir, post.frontmatter.slug);
		console.log(`   ✓ Generated ${post.frontmatter.slug}.html`);
	}

	// Generate blog index page
	const postsHtml = manifest
		.map((post) => {
			const tagsHtml = post.tags.length
				? `<div class="blog-post-card-tags">${post.tags.map((t) => `<span class="blog-tag">${escapeHtml(t)}</span>`).join("")}</div>`
				: "";
			return `
			<a href="${post.url}" class="blog-post-card">
				<h2 class="blog-post-card-title">${escapeHtml(post.title)}</h2>
				<div class="blog-post-card-meta">
					<time>${formatDate(post.date)}</time>
					<span class="blog-post-card-reading-time">${post.readingTime} min read</span>
				</div>
				${post.excerpt ? `<p class="blog-post-card-excerpt">${escapeHtml(post.excerpt)}</p>` : ""}
				${tagsHtml}
			</a>`;
		})
		.join("\n");

	const indexHtml = substituteTemplate(indexTemplate, {
		cssPath,
		posts: postsHtml,
		// Analytics constants (from src/analytics.ts)
		prodHost: PROD_HOST,
		proxyHost: PROXY_HOST,
		uiHost: UI_HOST,
		projectKey: PROJECT_KEY,
	});
	await writeFile(join(OUTPUT_DIR, "index.html"), indexHtml);
	console.log("   ✓ Generated index.html");

	console.log(`✅ Blog build complete! ${posts.length} posts published.`);
}

build().catch((err) => {
	console.error("❌ Blog build failed:", err);
	process.exit(1);
});
