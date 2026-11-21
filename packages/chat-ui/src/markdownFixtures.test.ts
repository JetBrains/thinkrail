export const MARKDOWN_EDGE_FIXTURES: Readonly<Record<string, string>> = {
	headingAfterParagraph: "para\n#x\n\nnext\n\n# Title\n\nbody",
	orderedListContinues: "1. a\n\n2. b\n\n3. c\n\nafter",
	bulletListContinues: "- a\n- b\n- c\n\nafter",
	setextHeading: "Foo\n---\n\nBar\n\n---\n\nBaz\n===\n\nend",
	paragraphBecomesTable: "intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter",
	looseAndNestedLists:
		"- one\n\n- two\n  - nested\n    - deeper\n\n  continued\n\n- three\n\n1. x\n   1. y\n\n2. z\n\ntail",
	blockquoteLazy: "> quoted\nlazy line\n> more\n\n> second\n\nafter",
	unclosedBacktickFence: "intro\n\n```ts\nconst a = 1;\n\nconst b = 2;",
	unclosedTildeFence: "intro\n\n~~~py\nx = 1\n\ny = 2",
	fourBacktickFence: "intro\n\n````md\n```ts\ninner\n```\n\nstill code\n````\n\nafter",
	indentedCode: "para\n\n    code one\n\n    code two\n\nafter\n\n\tline\n\n\tline2",
	detailsHtml: "<details>\n<summary>More</summary>\n\ninner text\n\n</details>\n\nafter",
	nestedDetails: "<div>\n\n<div>\n\na\n\n</div>\n\nb\n\n</div>\n\nafter",
	preHtml: "<pre>\nline\n\nline two\n</pre>\n\nafter",
	htmlComment: "<!-- note\n\nstill comment -->\n\nafter",
	linkDefinitionAtEnd: "See [the docs][docs].\n\nMore text.\n\n[docs]: https://example.com",
	footnoteAtEnd: "Claim[^1].\n\nMore.\n\n[^1]: Source.",
	definitionInBlockquote: "Use [x].\n\n> [x]: https://example.com\n\nafter",
	regexInlineCode: "Match `[^0-9]` and `[a-z]+` here.\n\nNext paragraph.\n\nLast.",
	definitionInsideFence: "intro\n\n```yaml\n  [key]: 1\n```\n\nafter",
	crlf: "# Title\r\n\r\n- a\r\n- b\r\n\r\n```ts\r\nconst x = 1;\r\n```\r\n\r\nend",
	tabs: "-\ta\n-\tb\n\n\tcode\n\npara\twith\ttabs",
	empty: "",
	whitespaceOnly: "   \n\n  \t\n",
	leadingBlankLines: "\n\n\nfirst\n\nsecond",
	mermaidFence: "intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nafter",
	listItemTrim: "intro\n\n- a\n- \n- b\n\nend",
	fenceInList:
		"1. Run:\n\n   ```bash\n   cmd one\n\n   cmd two\n   ```\n\n2. Next step\n\n   - sub\n\n     ```ts\n     const a = 1;\n\n     const b = 2;\n     ```\n\nDone.",
	lazyHtmlAfterList: "1. x\n<br> lazy\n\n2. y\n\n3. z\n\nafter",
	adjacentHtml: "<br>\n\n<br>\n</div>\n\ntext",
	headingsWithoutBlankLines:
		"## One\ntext one\n## Two\ntext two\n### Three\n- a\n- b\n## Four\nSetext\n---\nend\n***\nlast",
	fencesWithoutBlankLines:
		"intro\n```ts\nconst a = 1;\n```\nafter\n~~~~\n~~~\n~~~~\nmore\n```\nopen",
	htmlBeforeHeading: "2) two\n</div>\n## Heading\n***\n###### h6\n\n- \n<br>\npara\n   ---\n* star",
	invalidClosingFence: "```ts\n```~\n````\n````\n***\n\n## after\n\ntext",
	footnoteInList: "Claim[^1].\n\nx\n\ny\n\n- [^1]: multi word note\n\nz",
	footnoteInOrderedList: "Claim[^1].\n\nx\n\ny\n\n1. [^1]: note\n\nz",
	escapedFootnoteLabel: "Claim[^a\\]b].\n\nx\n\ny\n\n[^a\\]b]: two words\n\nz",
	surrogatePairs: "emoji 😀 here\n\n😀😀 **bold 🎉**\n\n- 🍕 item\n\n`🚀`",
	setextMisreadRule: "Text\n***\n-\n- b",
	setextMisreadRuleLazy: "Text\n***\n-\n   more",
	detailsChain:
		"<details>\n<summary>A</summary>\n\nbody a\n\n</details>\n\n<details>\n<summary>B</summary>\n\nbody b\n\n</details>\n\nPara one.\n\nPara two.\n\nPara three.",
	closedDiv: "<div>\n\nx\n\n</div>\n\nPara\n\nmore",
	unclosedComment: "<!-- note\n\nstill\n\nmore\n\nend",
	processingAfterParagraph: "Text\n<?php echo 1;\n\nmore\n\nend",
	declarationAfterParagraph: "Text\n<!DOCTYPE x\n\nmore\n\nend",
	cdataAfterParagraph: "Text\n<![CDATA[ x\n\nmore\n\nend",
	fenceTab: "```ts\ncode\n```\t\nafter\n```\nmore",
	openFenceInOrderedList: "1. Run:\n   ```bash\n   cmd\n\nDone.",
	openFenceInList: "- step\n  ```ts\n  const a = 1;\n\n  const b = 2;\n\nNext para",
	definitionInProse: "Intro paragraph.\n\n[Warning]: The build fails on Windows.\n\nNext.\n\nMore.",
};

export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const WORDS = ["the", "session", "renderer", "commits", "each", "delta", "while", "store", "rows"];

function sentence(random: () => number): string {
	const words = Array.from(
		{ length: 8 + Math.floor(random() * 10) },
		() => WORDS[Math.floor(random() * WORDS.length)] ?? "word",
	);
	const at = Math.floor(random() * words.length);
	const pick = random();
	if (pick < 0.3) words[at] = `\`${words[at]}()\``;
	else if (pick < 0.5) words[at] = `[${words[at]}](https://example.com/${words[at]})`;
	else if (pick < 0.65) words[at] = `**${words[at]}**`;
	return `${words.join(" ")}.`;
}

const paragraph = (random: () => number) =>
	Array.from({ length: 3 + Math.floor(random() * 3) }, () => sentence(random)).join(" ");

const FENCES = [
	"```ts\nexport function step(input: number): number {\n\treturn input * 2;\n}\n```",
	"```py\ndef step(value: int) -> int:\n    return value * 2\n```",
	"```bash\nbun run build && echo done | tee build.log\n```",
	'```json\n{\n  "enabled": true,\n  "weight": 3\n}\n```',
	"```mermaid\nflowchart LR\n  Store --> Chat --> Markdown\n```",
];

const TABLE =
	"| Component | Renders | Note |\n| --- | ---: | --- |\n| `Row` | 12 | stable |\n| `Turn` | 3 | streamed |";

export function longMarkdown(targetChars = 25_000, seed = 29): string {
	const random = seededRandom(seed);
	const blocks = [`# Render report\n\n${paragraph(random)}`];
	for (let section = 1, length = 0; length < targetChars; section += 1) {
		const list = Array.from(
			{ length: 3 + Math.floor(random() * 3) },
			(_, item) =>
				`${section % 2 === 0 ? `${item + 1}.` : "-"} ${sentence(random)}${random() < 0.4 ? `\n   - ${sentence(random)}` : ""}`,
		).join("\n");
		const block = [
			`## Section ${section}`,
			paragraph(random),
			list,
			FENCES[section % FENCES.length],
			...(section % 4 === 0 ? [TABLE] : []),
			paragraph(random),
		].join("\n\n");
		blocks.push(block);
		length += block.length + 2;
	}
	blocks.push("That is all.");
	return blocks.join("\n\n");
}
