import { describe, expect, test } from "bun:test";
import { CodeHighlighterProvider } from "@thinkrail/chat-ui/highlight";
import { fenceLanguage, Markdown } from "@thinkrail/chat-ui/Markdown";
import { renderToStaticMarkup } from "react-dom/server";
import {
	cachedHighlight,
	chatLanguageId,
	highlightCode,
	webCodeHighlighter,
} from "@/lib/highlightCode";

test("static renders never read the highlight cache", { timeout: 20_000 }, async () => {
	const code = "const cached = 2;";
	expect(await highlightCode(code, "ts", "static-seed")).toContain("highlights");
	expect(cachedHighlight(code, "ts")).toContain("highlights");
	const html = renderToStaticMarkup(
		<CodeHighlighterProvider highlighter={webCodeHighlighter}>
			<Markdown text={`\`\`\`ts\n${code}\n\`\`\``} />
		</CodeHighlighterProvider>,
	);
	expect(html).toContain(code);
	expect(html).not.toContain("highlights");
});

describe("fenceLanguage", () => {
	const components = {
		code: ({ className }: { className?: string | undefined }) => (
			<i>{chatLanguageId(fenceLanguage(className) ?? "")}</i>
		),
	};

	for (const [tag, id] of [
		["c", "c"],
		["c++", "cpp"],
		["c#", "csharp"],
		["java", "java"],
		["ts:src/a.ts", "typescript"],
		["js{1,3}", "javascript"],
	]) {
		test(`resolves a ${tag} fence to ${id}`, () => {
			const html = renderToStaticMarkup(
				<Markdown text={`\`\`\`${tag}\ncode\n\`\`\``} components={components} />,
			);
			expect(html).toContain(`<i>${id}</i>`);
		});
	}
});
