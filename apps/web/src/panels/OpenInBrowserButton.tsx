import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import type { ResourceOpenInBrowserProps } from "@thinkrail/resource-renderers";
import { IconButton } from "@thinkrail/ui/button";
import { ContextMenuItem } from "@thinkrail/ui/context-menu";
import { supportsBrowserView, useAppStore } from "../store";
import { isBrowserPage, openInBrowser } from "./resourcePane";

export function useBrowserViewSupported(): boolean {
	return useAppStore((s) => supportsBrowserView(s.protocolVersion));
}

export function OpenInBrowserButton({ workspaceId, path }: ResourceOpenInBrowserProps) {
	const t = useT();
	const supported = useBrowserViewSupported();
	if (!supported || !isBrowserPage(path)) return null;
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
	const supported = useBrowserViewSupported();
	if (!supported || !isBrowserPage(path)) return null;
	return (
		<ContextMenuItem data-testid={testId} onSelect={() => openInBrowser(workspaceId, path)}>
			<ExternalLink />
			{t("viewer.preview.openInBrowser")}
		</ContextMenuItem>
	);
}
