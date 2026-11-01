import { RiFileCopyLine as Copy } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import type { ReactElement } from "react";
import { copyText, workspaceFileCopyText } from "@/lib";

export function fileTreeCopyRelativePath(
	node: { path: string },
	directory: { path: string } | null,
): string {
	return directory?.path ?? node.path;
}

export function copyFileTreePath(
	worktreePath: string,
	relativePath: string,
	kind: "absolute" | "relative",
): Promise<boolean> {
	return copyText(workspaceFileCopyText(worktreePath, relativePath, kind));
}

export function FileCopyMenu({
	worktreePath,
	relativePath,
	children,
}: {
	worktreePath: string;
	relativePath: string;
	children: ReactElement;
}) {
	const t = useT();
	const copy = (kind: "absolute" | "relative") => {
		void copyFileTreePath(worktreePath, relativePath, kind);
	};
	return (
		<ContextMenu>
			<ContextMenuTrigger
				asChild
				onKeyDown={(event) => {
					if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
					event.preventDefault();
					const rect = event.currentTarget.getBoundingClientRect();
					event.currentTarget.dispatchEvent(
						new MouseEvent("contextmenu", {
							bubbles: true,
							clientX: rect.left,
							clientY: rect.bottom,
						}),
					);
				}}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent data-testid="file-copy-actions">
				<ContextMenuItem data-testid="file-copy-path" onSelect={() => copy("absolute")}>
					<Copy />
					{t("panels.fileTree.copyPath")}
				</ContextMenuItem>
				<ContextMenuItem data-testid="file-copy-relative-path" onSelect={() => copy("relative")}>
					<Copy />
					{t("panels.fileTree.copyRelativePath")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
