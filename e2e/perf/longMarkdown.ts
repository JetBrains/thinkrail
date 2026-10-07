import { seededRandom } from "./chatReplay";

const VOCABULARY = [
	"the",
	"session",
	"renderer",
	"commits",
	"each",
	"delta",
	"while",
	"the",
	"store",
	"selector",
	"keeps",
	"stable",
	"references",
	"so",
	"virtualized",
	"rows",
	"skip",
	"work",
	"when",
	"layout",
	"measurement",
	"settles",
	"after",
	"streaming",
	"ends",
	"and",
	"the",
	"compiler",
	"memoizes",
	"props",
	"for",
	"every",
	"workspace",
	"tab",
];

const LANGS = ["ts", "py", "bash", "json"] as const;

const LONG_STREAM_END = "the final sentence of the long stream report closes here.";

function sentence(random: () => number): string {
	const words = Array.from(
		{ length: 10 + Math.floor(random() * 14) },
		() => VOCABULARY[Math.floor(random() * VOCABULARY.length)] ?? "word",
	);
	const at = Math.floor(random() * words.length);
	if (random() < 0.35) words[at] = `\`${words[at]}()\``;
	else if (random() < 0.25) words[at] = `[${words[at]}](https://example.com/docs/${words[at]})`;
	else if (random() < 0.2) words[at] = `**${words[at]}**`;
	const text = words.join(" ");
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function paragraph(random: () => number): string {
	return Array.from({ length: 3 + Math.floor(random() * 4) }, () => sentence(random)).join(" ");
}

function nestedList(random: () => number, ordered: boolean): string {
	const lines: string[] = [];
	for (let item = 0; item < 4 + Math.floor(random() * 3); item += 1) {
		lines.push(`${ordered ? `${item + 1}.` : "-"} ${sentence(random)}`);
		for (let child = 0; child < Math.floor(random() * 3); child += 1)
			lines.push(`   - ${sentence(random)}`);
	}
	return lines.join("\n");
}

function codeLine(lang: (typeof LANGS)[number], line: number): string {
	switch (lang) {
		case "ts":
			return `export function step${line}(input: number): number {\n\treturn input * ${line} + ${line % 7};\n}`;
		case "py":
			return `def step_${line}(value: int) -> int:\n    return value * ${line} + ${line % 7}`;
		case "bash":
			return `bun run --cwd apps/web build && echo "step ${line} done" | tee -a build-${line}.log`;
		case "json":
			return `  "step${line}": { "enabled": ${line % 2 === 0}, "weight": ${line * 3} },`;
	}
}

function codeBlock(lang: (typeof LANGS)[number], lines: number): string {
	const body = Array.from({ length: lines }, (_, line) => codeLine(lang, line)).join("\n");
	return lang === "json"
		? `\`\`\`json\n{\n${body}\n  "last": true\n}\n\`\`\``
		: `\`\`\`${lang}\n${body}\n\`\`\``;
}

function table(random: () => number): string {
	const rows = Array.from({ length: 8 }, (_, row) => {
		const cost = (random() * 40).toFixed(2);
		return `| \`Component${row}\` | ${Math.floor(random() * 400)} | ${cost} ms | ${sentence(random).slice(0, 40)} |`;
	});
	return [
		"| Component | Renders | Self time | Note |",
		"| --- | ---: | ---: | --- |",
		...rows,
	].join("\n");
}

const MERMAID = [
	"```mermaid",
	"flowchart LR",
	"  Wire[WS frames] --> Batcher[pi event batcher]",
	"  Batcher --> Store[session runtime]",
	"  Store --> Chat[ChatView]",
	"  Chat --> Markdown[Markdown]",
	"  Markdown --> Dom[DOM commit]",
	"```",
].join("\n");

export function longMarkdown(targetChars = 25_000, seed = 29): string {
	const random = seededRandom(seed);
	const blocks: string[] = [`# Render report\n\n${paragraph(random)}`];
	let length = blocks[0]?.length ?? 0;
	for (let section = 1; length < targetChars; section += 1) {
		const parts = [
			`## Section ${section}`,
			paragraph(random),
			nestedList(random, section % 2 === 0),
		];
		parts.push(`### Details ${section}`, paragraph(random));
		const lang = LANGS[section % LANGS.length] ?? "ts";
		parts.push(codeBlock(lang, section === 4 ? 60 : 6 + Math.floor(random() * 10)));
		if (section === 3) parts.push(table(random));
		if (section === 5) parts.push(MERMAID);
		parts.push(paragraph(random));
		const block = parts.join("\n\n");
		blocks.push(block);
		length += block.length + 2;
	}
	blocks.push(`That is all, and ${LONG_STREAM_END}`);
	return blocks.join("\n\n");
}
