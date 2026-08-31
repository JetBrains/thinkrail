import { type ReactNode, useMemo } from "react";
import { type Components, defaultUrlTransform } from "react-markdown";
import { isWindowsAbsolutePath, workspaceFileTarget } from "./fileTargets";
import { Markdown } from "./Markdown";

export function assistantUrlTransform(
	value: string,
	property: string,
	node: { tagName: string },
): string {
	if (property === "href" && node.tagName === "a") {
		try {
			if (isWindowsAbsolutePath(decodeURIComponent(value))) return value;
		} catch {
			return defaultUrlTransform(value);
		}
	}
	return defaultUrlTransform(value);
}

export function assistantFileTarget(
	href: string | undefined,
	workspaceRoot: string | undefined,
): string | null {
	const candidate = href?.trim();
	if (!candidate || !workspaceRoot || candidate.startsWith("#") || candidate.startsWith("//")) {
		return null;
	}
	const encodedPath = candidate.split(/[?#]/, 1)[0];
	if (!encodedPath) return null;
	try {
		return workspaceFileTarget(decodeURIComponent(encodedPath), workspaceRoot);
	} catch {
		return null;
	}
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
		const safeHref = href === undefined ? undefined : defaultUrlTransform(href);
		return (
			<a href={safeHref} target="_blank" rel="noopener noreferrer">
				{children}
			</a>
		);
	}
	return (
		<button
			type="button"
			data-testid="chat-file-link"
			data-path={target}
			onClick={() => onOpenFile(target)}
			className="cursor-pointer text-left text-primary underline"
		>
			{children}
		</button>
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
	return <Markdown text={text} urlTransform={assistantUrlTransform} components={components} />;
}
