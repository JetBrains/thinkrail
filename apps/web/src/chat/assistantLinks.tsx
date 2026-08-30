import { type ReactNode, useMemo } from "react";
import type { Components } from "react-markdown";
import { Markdown } from "./Markdown";
import { toolFileTarget } from "./tools/ToolFileLink";

export function assistantFileTarget(
	href: string | undefined,
	workspaceRoot: string | undefined,
): string | null {
	const candidate = href?.trim();
	if (!candidate || !workspaceRoot || candidate.startsWith("#") || candidate.startsWith("//")) {
		return null;
	}
	const path = candidate.split(/[?#]/, 1)[0];
	return path ? toolFileTarget(path, workspaceRoot) : null;
}

function AssistantLink({
	href,
	children,
	workspaceRoot,
	onOpenFile,
}: {
	href?: string | undefined;
	children?: ReactNode;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const target = assistantFileTarget(href, workspaceRoot);
	if (!target || !onOpenFile) {
		return (
			<a href={href} target="_blank" rel="noopener noreferrer">
				{children}
			</a>
		);
	}
	return (
		<a
			href={href}
			data-testid="chat-file-link"
			data-path={target}
			onClick={(event) => {
				event.preventDefault();
				onOpenFile(target);
			}}
		>
			{children}
		</a>
	);
}

export function AssistantMarkdown({
	text,
	workspaceRoot,
	onOpenFile,
}: {
	text: string;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const components = useMemo<Components>(
		() => ({
			a: ({ href, children }) => (
				<AssistantLink href={href} workspaceRoot={workspaceRoot} onOpenFile={onOpenFile}>
					{children}
				</AssistantLink>
			),
		}),
		[workspaceRoot, onOpenFile],
	);
	return <Markdown text={text} components={components} />;
}
