# ThinkRail Blog Author Guide

This guide documents how to write and publish blog posts for thinkrail.ai/blog.

## Post Structure

Each post lives in its own directory under `content/blog/`:

```
content/
├── authors.json          # Author profiles, keyed by author key
└── blog/
    └── YYYY-MM-DD-post-slug/
        ├── index.md      # The post content
        └── images/       # Optional: local images
            ├── screenshot.png
            └── diagram.svg
```

The directory name should follow the pattern `YYYY-MM-DD-slug` for sorting, though the
actual publish date and URL slug come from frontmatter.

## Frontmatter Schema

Every post requires YAML frontmatter at the top of `index.md`:

```yaml
---
title: "Your Post Title"        # Required: displayed as H1 and in browser tab
slug: post-url-slug             # Required: becomes /blog/post-url-slug/
date: 2026-01-15                # Required: YYYY-MM-DD format (UTC)
author: author-key              # Required: a key from content/authors.json
excerpt: "A brief summary..."   # Optional: shown on blog index cards and as the page description
draft: true                     # Optional: if true, post is skipped in production builds
tags:                           # Optional: displayed on post and index cards
  - announcement
  - feature
---
```

The schema is validated at build time (`src/content.config.ts`): a missing required field, a
malformed slug, a reserved slug (`rss`, `images`, …), an author key that isn't in `authors.json`,
or two posts sharing one slug **fail the build** — broken posts cannot reach production.

### Field Details

| Field     | Required | Description                                              |
|-----------|----------|----------------------------------------------------------|
| `title`   | Yes      | Post title (don't repeat as H1 in body — it's rendered from frontmatter) |
| `slug`    | Yes      | URL slug (lowercase, hyphens, no spaces); becomes the permanent `/blog/<slug>/` URL |
| `date`    | Yes      | Publish date in `YYYY-MM-DD` format (interpreted as UTC) |
| `author`  | Yes      | Author key from `content/authors.json`; rendered as the post byline |
| `excerpt` | No       | 1-2 sentence summary for index cards, SEO description, and the RSS feed |
| `draft`   | No       | Set `true` to exclude from production builds (still visible in `bun run dev`) |
| `tags`    | No       | Array of lowercase tags for categorization               |

## Authors

Authors are a shared entity, not a per-post name: profiles live in `content/authors.json` and posts
reference one by key. Fixing a name or adding a link updates every post at once.

```json
{
  "maciej-gorywoda": { "name": "Maciej Gorywoda" },
  "jane-doe": { "name": "Jane Doe", "url": "https://example.com/jane" }
}
```

| Field  | Required | Description                                                       |
|--------|----------|-------------------------------------------------------------------|
| `name` | Yes      | Display name shown in the byline                                  |
| `url`  | No       | Profile/homepage link; the byline name becomes a link when present |

Adding a new author means adding an entry here, then using its key as a post's `author`. The byline
renders in the post header as `Author · Date · N min read`; the blog index cards and the RSS feed
intentionally don't show it.

## Markdown Features

Standard Markdown is fully supported, plus:

### Syntax Highlighting

Fenced code blocks with language hints get syntax highlighting (Shiki, via Astro), with dual
light/dark themes that follow the site's theme toggle:

````markdown
```typescript
const greeting: string = "Hello, ThinkRail!";
console.log(greeting);
```
````

### Local Images

Place images in an `images/` subdirectory and reference them with relative paths:

```markdown
![Screenshot of the settings panel](./images/settings.png)
```

Astro resolves, optimizes, and fingerprints them automatically during build.

### YouTube Videos

Embed YouTube videos using the `<iframe>` tag:

```html
<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" width="640" height="360" allowfullscreen></iframe>
```

Use the `youtube-nocookie.com` domain — the site's cookieless analytics stance (no consent
banner) forbids cookie-setting embeds. The build enforces this: plain `youtube.com/embed` URLs
are rewritten to the nocookie domain, and a `title` + `loading="lazy"` are added when omitted
(`src/youTubeEmbeds.ts`).

## Best Practices

1. **Don't duplicate the title**: The frontmatter `title` is rendered as the H1. Start the body
   below it — don't open with `# Same Title`.

2. **Use descriptive slugs**: The slug becomes the permanent URL. Choose something readable
   and SEO-friendly: `introducing-thinkrail` not `post-1`.

3. **Write an excerpt**: The excerpt appears on index cards, in the page's meta description,
   and in the RSS feed. Without one, visitors only see the title and date.

4. **Use draft mode**: Set `draft: true` while writing. Drafts render in the local dev server
   but are excluded from production builds.

5. **Optimize images**: Compress PNGs/JPGs before committing. Large images slow page loads.

6. **Preview locally**: Run `bun run dev` in `apps/website/` — the blog is served at
   `http://localhost:4321/blog/` with hot reload as you edit. `bun run build && bun run preview`
   shows the exact production output (drafts excluded).

## Build Process

The blog is part of the site's Astro build (`astro build`):

1. `content/blog/*/index.md` files load as a typed content collection (`src/content.config.ts`)
2. Frontmatter is validated against the schema — invalid posts fail the build
3. Markdown renders with Shiki dual-theme highlighting and the YouTube embed transform
4. Pages generate at `/blog/` (index) and `/blog/<slug>/` (posts), plus an RSS feed at
   `/blog/rss.xml`
5. Post images are optimized and emitted with hashed filenames

## Deployment

Blog posts deploy automatically via GitHub Actions when changes are pushed to
`apps/website/content/blog/**`. The same `site.yml` workflow handles both the main
site and blog.
