import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import type { ResourceOpenInBrowserProps } from "@thinkrail/resource-renderers";
import { IconButton } from "@thinkrail/ui/button";
import { ContextMenuItem } from "@thinkrail/ui/context-menu";
import { supportsBrowserView, useAppStore } from "../store";
import { isBrowserPage, openInBrowser } from "./resourcePane";

export function useOpensInBrowser(path: string): boolean {
	const supported = useAppStore((s) => supportsBrowserView(s.protocolVersion));
	return supported && isBrowserPage(path);
}

export function OpenInBrowserButton({ workspaceId, path }: ResourceOpenInBrowserProps) {
	const t = useT();
	if (!useOpensInBrowser(path)) return null;
	return (
		<IconButton
			icon={ExternalLink}
			label={t("viewer.preview.openInBrowser")}
			tabIndex={0}
			data-testid="open-in-browser"
			onClick={() => openInBrowser(workspaceId, path)}
		/>
	);
}

export function OpenInBrowserMenuItem({
	workspaceId,
	path,
	testId,
}: ResourceOpenInBrowserProps & { testId: string }) {
	const t = useT();
	if (!useOpensInBrowser(path)) return null;
	return (
		<ContextMenuItem data-testid={testId} onSelect={() => openInBrowser(workspaceId, path)}>
			<ExternalLink />
			{t("viewer.preview.openInBrowser")}
		</ContextMenuItem>
	);
}
