import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ResourceMarkdownProps } from "../host";

export function TestMarkdown({ text, className, remarkPlugins, ...rest }: ResourceMarkdownProps) {
	return (
		<div className={className}>
			<ReactMarkdown remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]} {...rest}>
				{text}
			</ReactMarkdown>
		</div>
	);
}

export const testLinks = {
	bytesUrl: (workspaceId: string, path: string) => `http://host.test/files/${workspaceId}/${path}`,
	openFile: () => {},
};
