import { expect, test } from "bun:test";
import { CodeHighlighterProvider } from "@thinkrail/chat-ui/highlight";
import { Markdown } from "@thinkrail/chat-ui/Markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { cachedHighlight, highlightCode, webCodeHighlighter } from "@/lib/highlightCode";

test("static renders never read the highlight cache", { timeout: 20_000 }, async () => {
	const code = "const cached = 2;";
	expect(await highlightCode(code, "ts", "static-seed")).toContain("shiki");
	expect(cachedHighlight(code, "ts")).toContain("shiki");
	const html = renderToStaticMarkup(
		<CodeHighlighterProvider highlighter={webCodeHighlighter}>
			<Markdown text={`\`\`\`ts\n${code}\n\`\`\``} />
		</CodeHighlighterProvider>,
	);
	expect(html).toContain(code);
	expect(html).not.toContain("shiki");
});
