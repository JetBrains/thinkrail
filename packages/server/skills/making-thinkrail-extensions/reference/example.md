# A complete extension: word count

One tool, `word_count`, one card for it and one setting. Every file below is the whole file; copy them
into `~/thinkrail-extensions/word-count/`, then build and install as SKILL.md says. To make your own,
rename `word-count` / `wordcount` / `word_count` everywhere and replace the logic.

### `package.json`

```json
{
	"name": "thinkrail-ext-word-count",
	"version": "0.1.0",
	"description": "Counts the words, lines and characters of a text and shows them as a card.",
	"type": "module",
	"private": true,
	"keywords": ["thinkrail-extension"],
	"thinkrail": {
		"api": "1.0",
		"server": "./server/index.ts",
		"web": "./dist/web.js",
		"styles": "./dist/web.css",
		"title": "Word count"
	},
	"scripts": {
		"build": "thinkrail-extension build --prefix wordcount"
	},
	"devDependencies": {
		"@thinkrail/extension-sdk": "~1.0.0"
	},
	"peerDependencies": {
		"@earendil-works/pi-coding-agent": "*",
		"typebox": "*"
	}
}
```

- `api` and the SDK range follow the host's API from `extensions.mjs where`: `"api": "<api>"`,
  `"@thinkrail/extension-sdk": "~<api>.0"`.
- `private: true` keeps it off npm by accident; remove it when the user decides to publish.
- `.npmrc` makes every `npm install` in the folder leave out the peers (ThinkRail provides pi and
  typebox; a copy in `node_modules` is ~190 MB and is what a plain-JavaScript dependency would bind to).
  npm never publishes it.

### `.npmrc`

```ini
omit=peer
```

### `server/index.ts`

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	ExtensionSessionServices,
	ServerExtension,
} from "@thinkrail/extension-sdk/server";
import { Type } from "typebox";

const WORDS_PER_MINUTE = 230;

interface Counts {
	words: number;
	lines: number;
	characters: number;
	readingMinutes?: number;
}

function count(text: string, readingTime: boolean): Counts {
	const words = text.split(/\s+/).filter(Boolean).length;
	const counts: Counts = {
		words,
		lines: text === "" ? 0 : text.split(/\r?\n/).length,
		characters: [...text].length,
	};
	if (readingTime) counts.readingMinutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
	return counts;
}

function wordCountTool(session: ExtensionSessionServices) {
	return (pi: ExtensionAPI) => {
		const readingTime = session.setting("readingTime");
		pi.registerTool({
			name: "word_count",
			label: "Word count",
			description: "Count the words, lines and characters in a text.",
			promptSnippet: "Count the words, lines and characters of a text and show them as a card.",
			parameters: Type.Object({
				text: Type.String({ description: "The text to count." }),
			}),
			async execute(_toolCallId, params) {
				const counts = count(params.text, readingTime);
				const reading =
					counts.readingMinutes === undefined ? "" : `, about ${counts.readingMinutes} min to read`;
				return {
					content: [
						{
							type: "text",
							text: `${counts.words} words, ${counts.lines} lines, ${counts.characters} characters${reading}.`,
						},
					],
					details: counts,
				};
			},
		});
	};
}

export default {
	name: "thinkrail-ext-word-count",
	title: "Word count",
	description: "Lets the agent count words, lines and characters, shown as a card.",
	extensions: [],
	sessionExtensions: (session) => [wordCountTool(session)],
	settings: {
		readingTime: {
			type: "boolean",
			default: true,
			title: "Reading time",
			description: "Also estimate how long the text takes to read.",
		},
	},
} satisfies ServerExtension;
```

### `web/index.tsx`

```tsx
import { defineWebExtension, type ToolRenderProps } from "@thinkrail/extension-sdk/web";

interface Counts {
	words: number;
	lines: number;
	characters: number;
	readingMinutes?: number;
}

function countsOf(result: unknown): Counts | undefined {
	const details = (result as { details?: Partial<Counts> } | undefined)?.details;
	if (typeof details?.words !== "number") return undefined;
	return {
		words: details.words,
		lines: details.lines ?? 0,
		characters: details.characters ?? 0,
		...(typeof details.readingMinutes === "number"
			? { readingMinutes: details.readingMinutes }
			: {}),
	};
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="wordcount:flex wordcount:flex-col wordcount:gap-2 wordcount:rounded-md wordcount:bg-sunken wordcount:p-8">
			<span className="tr-heading-sm wordcount:text-text-default">{value}</span>
			<span className="tr-text-metadata wordcount:text-text-muted">{label}</span>
		</div>
	);
}

function WordCountCard({ result, status }: ToolRenderProps) {
	const counts = countsOf(result);
	if (!counts) {
		return (
			<p className="tr-text-metadata wordcount:text-text-muted">
				{status === "error" ? "The text could not be counted." : "Counting…"}
			</p>
		);
	}
	return (
		<div className="wordcount:grid wordcount:grid-cols-4 wordcount:gap-8">
			<Stat label="Words" value={String(counts.words)} />
			<Stat label="Lines" value={String(counts.lines)} />
			<Stat label="Characters" value={String(counts.characters)} />
			{counts.readingMinutes === undefined ? null : (
				<Stat label="Reading time" value={`${counts.readingMinutes} min`} />
			)}
		</div>
	);
}

export default defineWebExtension({
	name: "thinkrail-ext-word-count",
	toolRenderers: {
		word_count: {
			renderer: WordCountCard,
			options: {
				prominence: "primary",
				defaultExpanded: true,
				summary: ({ result }) => {
					const counts = countsOf(result);
					return counts ? `${counts.words} words` : "Word count";
				},
			},
		},
	},
});
```

## What this example shows

- The tool is registered per session (`sessionExtensions`) because it reads a setting; a tool without
  settings can go in `extensions: [(pi) => { pi.registerTool(…) }]` instead.
- `details` is the structured result the card reads; `content` is what the model reads.
- The card handles a running call (no result yet) and an error, and uses only prefixed utilities
  (`wordcount:`) plus the app's unprefixed `tr-*` typography classes.
