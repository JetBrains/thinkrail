import { RiFolderOpenLine } from "@remixicon/react";
import { t, useT } from "@thinkrail/locales/react";
import { ContextMenuItem } from "@thinkrail/ui/context-menu";
import { selectCanRevealWorkspaceItem, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";

export async function revealWorkspaceItem(workspaceId: string, path: string): Promise<void> {
	if (!selectCanRevealWorkspaceItem(useAppStore.getState())) return;
	try {
		await getTransport().request("workspace.reveal", { id: workspaceId, path });
	} catch (error) {
		toast.error(errorText(error, t("panels.fileReveal.failed")));
	}
}

export function FileRevealMenuItem({
	workspaceId,
	path,
	showIcon = false,
}: {
	workspaceId: string;
	path: string;
	showIcon?: boolean;
}) {
	const t = useT();
	const enabled = useAppStore(selectCanRevealWorkspaceItem);
	const status = useAppStore((state) => state.status);
	const platform = useAppStore((state) => state.hostPlatform);
	const label =
		platform === "darwin"
			? t("panels.fileReveal.finder")
			: platform === "win32"
				? t("panels.fileReveal.explorer")
				: t("panels.fileReveal.generic");
	const unavailable =
		status !== "connected"
			? t("panels.fileReveal.offline")
			: t("panels.fileReveal.unsupportedHost");
	return (
		<ContextMenuItem
			data-testid="file-reveal"
			disabled={!enabled}
			title={enabled ? undefined : unavailable}
			aria-description={enabled ? undefined : unavailable}
			onSelect={() => void revealWorkspaceItem(workspaceId, path)}
		>
			{showIcon ? <RiFolderOpenLine /> : null}
			{label}
		</ContextMenuItem>
	);
}
