import { memo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { FrontmatterCard, extractFrontmatter } from "@/components/FileViewer/FrontmatterCard";

function ExternalLink(props: ComponentPropsWithoutRef<"a">) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

interface ChatMarkdownProps {
  content: string;
}

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
}: ChatMarkdownProps) {
  const frontmatter = extractFrontmatter(content);
  return (
    <div className="chat-md">
      <FrontmatterCard value={frontmatter ?? undefined} />
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFrontmatter]}
        components={{ a: ExternalLink }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
