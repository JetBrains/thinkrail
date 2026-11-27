import { RiFileLine, RiFolderOpenLine } from "@remixicon/react";
import type { HostPlatform } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { ContextMenuItem } from "@thinkrail/ui/context-menu";
import { useAppStore } from "../store";
import { revealInFileManager, revealInFilesPanel, supportsFsReveal } from "./fileTreeActions";

interface RevealMenuItemProps {
	workspaceId: string;
	path: string;
	testId: string;
}

export function revealInFileManagerLabel(platform: HostPlatform | null): MessageKey {
	if (platform === "darwin") return "panels.reveal.finder";
	if (platform === "win32") return "panels.reveal.explorer";
	return "panels.reveal.fileManager";
}

export function RevealInFileManagerMenuItem({ workspaceId, path, testId }: RevealMenuItemProps) {
	const t = useT();
	const supported = useAppStore((s) => supportsFsReveal(s.protocolVersion));
	const label = useAppStore((s) => revealInFileManagerLabel(s.hostPlatform));
	if (!supported) return null;
	return (
		<ContextMenuItem data-testid={testId} onSelect={() => revealInFileManager(workspaceId, path)}>
			<RiFolderOpenLine />
			{t(label)}
		</ContextMenuItem>
	);
}

export function RevealInFilesMenuItem({ workspaceId, path, testId }: RevealMenuItemProps) {
	const t = useT();
	return (
		<ContextMenuItem data-testid={testId} onSelect={() => revealInFilesPanel(workspaceId, path)}>
			<RiFileLine />
			{t("panels.reveal.files")}
		</ContextMenuItem>
	);
}
